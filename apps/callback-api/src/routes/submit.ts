import { Hono } from "hono"
import type { Context } from "hono"

import type { AppBindings, RuntimeEnv } from "../types"
import type { WedgeCallbackConfig } from "../lib/config"
import type { RateLimiter } from "../lib/rate-limit"
import type { SessionStore } from "../lib/session-store"
import { DestinationError, resolveDestination } from "../lib/destinations"
import {
  ERR_CONTENT_TYPE_INVALID,
  ERR_DESTINATION_NOT_FOUND,
  ERR_INVALID_SUBMIT_SHAPE,
  ERR_ORIGIN_NOT_ALLOWED,
  ERR_PAYLOAD_TOO_LARGE,
  ERR_RATE_LIMITED,
  errorResponse,
  jsonResponse,
  withHeaders,
} from "../lib/errors"
import { checkOrigin, corsHeadersFor } from "../lib/origin"
import { publicBaseUrl } from "../lib/public-url"
import { hashReadToken, mintReadToken } from "../lib/read-token"
import { generateNonce, signCallback } from "../lib/signing"

const MAX_BODY_BYTES = 64 * 1024
const CLAY_WEBHOOK_AUTH_HEADER = "x-clay-webhook-auth"

export type WebhookDispatcher = (
  url: string,
  body: unknown,
  options: {
    destinationId: string
    headers: Record<string, string>
    timeoutMs: number
  }
) => Promise<void>

export function submitRoute(deps: {
  config: WedgeCallbackConfig
  env: RuntimeEnv
  store: SessionStore
  rateLimiter: RateLimiter
  dispatchWebhook?: WebhookDispatcher
}) {
  const app = new Hono<AppBindings>()
  const dispatch = deps.dispatchWebhook ?? dispatchEnrichmentWebhook

  app.post("/api/submit", async (c) =>
    handleSubmit(c, deps.config, deps.env, deps.store, deps.rateLimiter, dispatch)
  )

  return app
}

async function handleSubmit(
  c: Context<AppBindings>,
  config: WedgeCallbackConfig,
  env: RuntimeEnv,
  store: SessionStore,
  rateLimiter: RateLimiter,
  dispatch: WebhookDispatcher
) {
  const allowedOrigin = checkOrigin(c.req.header("origin"), config.security.allowedOrigins)
  if (!allowedOrigin) {
    return errorResponse(403, {
      error: ERR_ORIGIN_NOT_ALLOWED,
      problem: "Origin header is missing or not in the allowed list.",
      fix: "Add the Chrome extension origin to WEDGE_CALLBACK_ALLOWED_ORIGINS.",
    })
  }

  const corsHeaders = corsHeadersFor(allowedOrigin, "submit")
  const rateLimit = await rateLimiter.checkAndIncrement({
    ip: clientIp(c),
    limit: config.security.rateLimitPerIpPerMinute,
  })
  if (!rateLimit.allowed) {
    const response = errorResponse(429, {
      error: ERR_RATE_LIMITED,
      problem: "Too many callback submissions from this IP.",
      fix: `Retry after ${rateLimit.retryAfterSeconds} seconds.`,
    })
    response.headers.set("Retry-After", String(rateLimit.retryAfterSeconds))
    return withHeaders(response, corsHeaders)
  }

  const contentType = c.req.header("content-type") ?? ""
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return withHeaders(
      errorResponse(415, {
        error: ERR_CONTENT_TYPE_INVALID,
        problem: "Content-Type must be application/json.",
        cause: `Received '${contentType || "(none)"}'.`,
      }),
      corsHeaders
    )
  }

  const bodyText = await readBoundedBody(c, MAX_BODY_BYTES)
  if (bodyText === null) {
    return withHeaders(
      errorResponse(413, {
        error: ERR_PAYLOAD_TOO_LARGE,
        problem: `Request body exceeds ${MAX_BODY_BYTES} bytes.`,
        fix: "Reduce the Wedge payload before sending.",
      }),
      corsHeaders
    )
  }

  const parsed = parseSubmitBody(bodyText)
  if (!parsed.ok) {
    return withHeaders(
      errorResponse(400, {
        error: ERR_INVALID_SUBMIT_SHAPE,
        problem: parsed.message,
        fix: "Send { lead: { ...payload }, destination_id?: string }. Do not send Clay URLs or auth tokens in callback mode.",
      }),
      corsHeaders
    )
  }

  let destination
  try {
    destination = resolveDestination(env, parsed.destinationId)
  } catch (error) {
    const message = error instanceof DestinationError ? error.message : "Destination could not be resolved."
    return withHeaders(
      errorResponse(400, {
        error: ERR_DESTINATION_NOT_FOUND,
        problem: message,
        fix: "Configure WEDGE_CALLBACK_DESTINATIONS with this destination_id or a default destination.",
      }),
      corsHeaders
    )
  }

  const sessionId = crypto.randomUUID()
  const readToken = mintReadToken()
  const nowUnix = Math.floor(Date.now() / 1000)
  const expiresAt = nowUnix + config.security.sessionTtlSeconds
  const signed = signCallback({
    sessionId,
    expiresAt,
    nonce: generateNonce(),
    kid: "primary",
    signingKey: env.WEDGE_CALLBACK_SIGNING_KEY,
  })
  const callbackUrl =
    `${publicBaseUrl(c, env)}/api/callback/${sessionId}` +
    `?exp=${signed.expiresAt}` +
    `&sig=${encodeURIComponent(signed.sig)}` +
    `&nonce=${encodeURIComponent(signed.nonce)}` +
    `&kid=${encodeURIComponent(signed.kid)}`

  await store.writePending({
    sessionId,
    readTokenHash: hashReadToken(readToken, env.WEDGE_CALLBACK_READ_KEY),
    origin: allowedOrigin,
    expiresAtUnix: expiresAt,
    ttlSeconds: config.security.sessionTtlSeconds,
    destinationId: destination.id,
  })

  const webhookBody = {
    session_id: sessionId,
    callback_url: callbackUrl,
    lead: parsed.lead,
    destination_id: destination.id,
    meta: {
      submitted_at: new Date(nowUnix * 1000).toISOString(),
    },
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-wedge-callback-session-id": sessionId,
    ...(destination.headers ?? {}),
  }
  if (destination.auth_token) {
    headers[CLAY_WEBHOOK_AUTH_HEADER] = destination.auth_token
  }

  void dispatch(destination.webhook_url, webhookBody, {
    destinationId: destination.id,
    headers,
    timeoutMs: config.enrichment.timeoutMs,
  }).catch(() =>
    store
      .transitionToTerminal({
        sessionId,
        status: "failed",
        errorCode: "CLAY_DISPATCH_FAILED",
      })
      .catch(() => undefined)
  )

  return withHeaders(
    jsonResponse({
      session_id: sessionId,
      read_token: readToken,
      expires_at: expiresAt,
    }),
    corsHeaders
  )
}

function parseSubmitBody(bodyText: string):
  | { ok: true; lead: Record<string, unknown>; destinationId?: string }
  | { ok: false; message: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(bodyText)
  } catch {
    return { ok: false, message: "Request body must be valid JSON." }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, message: "Request body must be a JSON object." }
  }

  const object = parsed as Record<string, unknown>
  const lead = object.lead
  if (!lead || typeof lead !== "object" || Array.isArray(lead)) {
    return { ok: false, message: "Request body must include a lead object." }
  }

  const destinationId =
    typeof object.destination_id === "string"
      ? object.destination_id
      : typeof object.form_id === "string"
        ? object.form_id
        : undefined

  return { ok: true, lead: lead as Record<string, unknown>, destinationId }
}

async function readBoundedBody(c: Context<AppBindings>, maxBytes: number) {
  const contentLength = c.req.header("content-length")
  if (contentLength !== undefined) {
    const declared = Number.parseInt(contentLength, 10)
    if (Number.isFinite(declared) && declared > maxBytes) {
      return null
    }
  }

  const bodyText = await c.req.text()
  return new TextEncoder().encode(bodyText).byteLength > maxBytes ? null : bodyText
}

async function dispatchEnrichmentWebhook(
  url: string,
  body: unknown,
  options: { headers: Record<string, string>; timeoutMs: number; destinationId: string }
) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs)
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: options.headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error(`Clay destination ${options.destinationId} returned ${response.status}.`)
    }
  } finally {
    clearTimeout(timeout)
  }
}

function clientIp(c: Context<AppBindings>) {
  return (
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("cf-connecting-ip") ||
    "unknown"
  )
}
