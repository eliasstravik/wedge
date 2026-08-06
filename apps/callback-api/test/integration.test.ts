import { describe, expect, it } from "vitest"

import { createApp } from "../src/index"
import type { WedgeCallbackConfig } from "../src/lib/config"
import { MemoryRateLimiter } from "../src/lib/rate-limit"
import { MemorySessionStore } from "../src/lib/session-store"
import { generateNonce, signCallback } from "../src/lib/signing"
import type { RuntimeEnv } from "../src/types"

const ALLOWED_ORIGIN = "chrome-extension://extension-id"
const SERVER_HOST = "callback.wedge.test"
const SIGNING_KEY = "test-signing-key-32-bytes-minimum-length"
const READ_KEY = "test-read-key-32-bytes-minimum-length"

const config: WedgeCallbackConfig = {
  enrichment: { timeoutMs: 10_000 },
  security: {
    allowedOrigins: [ALLOWED_ORIGIN],
    rateLimitPerIpPerMinute: 20,
    sessionTtlSeconds: 600,
  },
  storage: {
    requirePersistent: false,
  },
}

const env: RuntimeEnv = {
  WEDGE_CALLBACK_ENV: "test",
  WEDGE_CALLBACK_SIGNING_KEY: SIGNING_KEY,
  WEDGE_CALLBACK_READ_KEY: READ_KEY,
  WEDGE_CALLBACK_DESTINATIONS: JSON.stringify({
    default: {
      webhook_url: "https://hooks.example.com/default",
      auth_token: "clay-secret",
    },
    leads: {
      webhook_url: "https://hooks.example.com/leads",
      headers: { "x-custom": "leads" },
    },
  }),
  WEDGE_CALLBACK_ALLOWED_ORIGINS: ALLOWED_ORIGIN,
}

type WebhookCall = {
  url: string
  body: unknown
  options: {
    destinationId: string
    headers: Record<string, string>
    timeoutMs: number
  }
}

function makeHarness() {
  const calls: WebhookCall[] = []
  const app = createApp({
    config,
    env,
    store: new MemorySessionStore(),
    rateLimiter: new MemoryRateLimiter(),
    dispatchWebhook: async (url, body, options) => {
      calls.push({ url, body, options })
    },
  })
  const request = (path: string, init?: RequestInit) =>
    Promise.resolve(app.request(`https://${SERVER_HOST}${path}`, init))

  return { calls, request }
}

describe("callback API integration", () => {
  it("submits to a server-side destination, stores callback result, and polls ready", async () => {
    const harness = makeHarness()

    const submitResponse = await submit(harness.request, {
      body: { lead: { email: "alice@example.com" }, destination_id: "leads" },
    })
    expect(submitResponse.status).toBe(200)
    const submitBody = (await submitResponse.json()) as {
      session_id: string
      read_token: string
      expires_at: number
    }

    expect(harness.calls).toHaveLength(1)
    expect(harness.calls[0]).toMatchObject({
      url: "https://hooks.example.com/leads",
      options: {
        destinationId: "leads",
        headers: {
          "Content-Type": "application/json",
          "x-custom": "leads",
        },
      },
    })
    expect(harness.calls[0]?.options.headers).not.toHaveProperty("x-clay-webhook-auth")
    expect(harness.calls[0]?.body).toMatchObject({
      session_id: submitBody.session_id,
      lead: { email: "alice@example.com" },
      destination_id: "leads",
    })

    const callbackUrl = await signedCallbackPath(submitBody.session_id)
    const callbackResponse = await harness.request(callbackUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: submitBody.session_id,
        status: "ok",
        result: {
          title: "Enrichment ready",
          summary: "Verified company data.",
          fields: [{ label: "Company", value: "Acme" }],
          actions: [{ type: "copy_value", label: "Copy company", value: "Acme" }],
        },
      }),
    })
    expect(callbackResponse.status).toBe(200)

    const pollResponse = await poll(harness.request, submitBody.session_id, submitBody.read_token)
    expect(pollResponse.status).toBe(200)
    await expect(pollResponse.json()).resolves.toMatchObject({
      status: "ready",
      result: {
        title: "Enrichment ready",
        fields: [{ label: "Company", value: "Acme" }],
      },
    })
  })

  it("uses the default destination and server-side auth token without accepting secrets from the extension", async () => {
    const harness = makeHarness()

    const response = await submit(harness.request, {
      body: {
        lead: { company: "Acme" },
        webhook_url: "https://attacker.example.com",
        auth_token: "do-not-use",
      },
    })

    expect(response.status).toBe(200)
    expect(harness.calls[0]?.url).toBe("https://hooks.example.com/default")
    expect(harness.calls[0]?.options.headers["x-clay-webhook-auth"]).toBe("clay-secret")
  })

  it("rejects disallowed extension origins and wrong read tokens", async () => {
    const harness = makeHarness()

    const disallowed = await submit(harness.request, {
      origin: "chrome-extension://other-extension",
      body: { lead: { email: "alice@example.com" } },
    })
    expect(disallowed.status).toBe(403)

    const allowed = await submit(harness.request, {
      body: { lead: { email: "alice@example.com" } },
    })
    const allowedBody = (await allowed.json()) as { session_id: string }
    const pollResponse = await poll(harness.request, allowedBody.session_id, "wrong")
    expect(pollResponse.status).toBe(403)
  })

  it("marks malformed signed callbacks failed so polling stops waiting", async () => {
    const harness = makeHarness()
    const submitResponse = await submit(harness.request, {
      body: { lead: { email: "alice@example.com" } },
    })
    const submitBody = (await submitResponse.json()) as {
      session_id: string
      read_token: string
    }

    const callbackResponse = await harness.request(await signedCallbackPath(submitBody.session_id), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: submitBody.session_id,
        status: "ok",
        result: { title: "Ready" },
        raw_row: { forbidden: true },
      }),
    })
    expect(callbackResponse.status).toBe(400)

    const pollResponse = await poll(harness.request, submitBody.session_id, submitBody.read_token)
    expect(pollResponse.status).toBe(200)
    await expect(pollResponse.json()).resolves.toEqual({
      status: "failed",
      error_code: "INVALID_CALLBACK_PAYLOAD",
    })
  })
})

async function submit(
  request: (path: string, init?: RequestInit) => Promise<Response>,
  input: { body: unknown; origin?: string }
) {
  return request("/api/submit", {
    method: "POST",
    headers: {
      Origin: input.origin ?? ALLOWED_ORIGIN,
      "Content-Type": "application/json",
      Host: SERVER_HOST,
    },
    body: JSON.stringify(input.body),
  })
}

async function poll(
  request: (path: string, init?: RequestInit) => Promise<Response>,
  sessionId: string,
  readToken: string
) {
  return request(`/api/session/${sessionId}`, {
    method: "GET",
    headers: {
      Origin: ALLOWED_ORIGIN,
      Authorization: `Bearer ${readToken}`,
      Host: SERVER_HOST,
    },
  })
}

async function signedCallbackPath(sessionId: string) {
  const signed = signCallback({
    sessionId,
    expiresAt: Math.floor(Date.now() / 1000) + 600,
    nonce: generateNonce(),
    kid: "primary",
    signingKey: SIGNING_KEY,
  })
  return `/api/callback/${sessionId}?exp=${signed.expiresAt}&sig=${encodeURIComponent(
    signed.sig
  )}&nonce=${signed.nonce}&kid=${signed.kid}`
}
