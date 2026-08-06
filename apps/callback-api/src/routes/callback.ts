import { Hono } from "hono"
import type { Context } from "hono"

import type { AppBindings, RuntimeEnv } from "../types"
import type { WedgeCallbackConfig } from "../lib/config"
import type { RateLimiter } from "../lib/rate-limit"
import type { SessionStore } from "../lib/session-store"
import {
  ERR_CALLBACK_CONFLICT,
  ERR_INVALID_CALLBACK_PAYLOAD,
  ERR_MISSING_SIG_PARAMS,
  ERR_PAYLOAD_TOO_LARGE,
  ERR_RATE_LIMITED,
  ERR_SESSION_NOT_FOUND,
  ERR_SESSION_NOT_PENDING,
  ERR_SIGNATURE_EXPIRED,
  ERR_SIGNATURE_INVALID,
  ERR_UNKNOWN_KID,
  errorResponse,
  jsonResponse,
} from "../lib/errors"
import {
  ProtocolParseError,
  parseErrorCallback,
  parseSuccessCallback,
  stableResultHash,
} from "../lib/protocol"
import { verifyCallback } from "../lib/signing"

const MAX_BODY_BYTES = 64 * 1024

export function callbackRoute(deps: {
  config: WedgeCallbackConfig
  env: RuntimeEnv
  store: SessionStore
  rateLimiter: RateLimiter
}) {
  const app = new Hono<AppBindings>()

  app.post("/api/callback/:sessionId", async (c) =>
    handleCallback(c, deps.config, deps.env, deps.store, deps.rateLimiter)
  )

  return app
}

async function handleCallback(
  c: Context<AppBindings>,
  config: WedgeCallbackConfig,
  env: RuntimeEnv,
  store: SessionStore,
  rateLimiter: RateLimiter
) {
  const sessionId = c.req.param("sessionId")
  if (!sessionId) {
    return missingSignatureResponse()
  }

  const rateLimit = await rateLimiter.checkAndIncrement({
    ip: clientIp(c),
    limit: config.security.rateLimitPerIpPerMinute,
  })
  if (!rateLimit.allowed) {
    const response = errorResponse(429, {
      error: ERR_RATE_LIMITED,
      problem: "Too many callback attempts from this IP.",
      fix: `Retry after ${rateLimit.retryAfterSeconds} seconds.`,
    })
    response.headers.set("Retry-After", String(rateLimit.retryAfterSeconds))
    return response
  }

  const sig = c.req.query("sig")
  const expRaw = c.req.query("exp")
  const nonce = c.req.query("nonce")
  const kid = c.req.query("kid")
  if (!sig || !expRaw || !nonce || !kid) {
    return missingSignatureResponse()
  }

  const expiresAt = Number.parseInt(expRaw, 10)
  if (!Number.isFinite(expiresAt) || expiresAt < 0) {
    return missingSignatureResponse()
  }

  const verified = verifyCallback({
    sessionId,
    sig,
    expiresAt,
    nonce,
    kid,
    primaryKey: env.WEDGE_CALLBACK_SIGNING_KEY,
    previousKey: env.WEDGE_CALLBACK_SIGNING_KEY_PREVIOUS,
  })
  if (!verified.valid) {
    return signatureErrorResponse(verified.reason)
  }

  const bodyText = await readBoundedBody(c, MAX_BODY_BYTES)
  if (bodyText === null) {
    return errorResponse(413, {
      error: ERR_PAYLOAD_TOO_LARGE,
      problem: `Callback body exceeds ${MAX_BODY_BYTES} bytes.`,
      fix: "Shrink the display-oriented enrichment result.",
    })
  }

  let raw: unknown
  try {
    raw = JSON.parse(bodyText)
  } catch {
    await failSession(store, sessionId, "INVALID_CALLBACK_PAYLOAD")
    return invalidPayloadResponse("Callback body must be valid JSON.")
  }

  const parsedError = parseErrorCallback(raw)
  if (parsedError.success) {
    if (parsedError.data.session_id !== sessionId) {
      await failSession(store, sessionId, "INVALID_CALLBACK_PAYLOAD")
      return invalidPayloadResponse("Callback session_id did not match the signed URL session.")
    }
    const transition = await store.transitionToTerminal({
      sessionId,
      status: "failed",
      errorCode: parsedError.data.error_code,
    })
    return responseForTransition(transition)
  }

  let parsed
  try {
    parsed = parseSuccessCallback(raw)
  } catch (error) {
    await failSession(
      store,
      sessionId,
      error instanceof ProtocolParseError ? error.code : "INVALID_CALLBACK_PAYLOAD"
    )
    return invalidPayloadResponse(error instanceof Error ? error.message : "Callback body is invalid.")
  }

  if (parsed.session_id !== sessionId) {
    await failSession(store, sessionId, "INVALID_CALLBACK_PAYLOAD")
    return invalidPayloadResponse("Callback session_id did not match the signed URL session.")
  }

  const resultHash = await stableResultHash(parsed.result)
  const transition = await store.transitionToTerminal({
    sessionId,
    status: "ready",
    resultHash,
    resultPayload: parsed.result,
  })

  return responseForTransition(transition)
}

function responseForTransition(
  transition: Awaited<ReturnType<SessionStore["transitionToTerminal"]>>
) {
  switch (transition.kind) {
    case "transitioned":
      return jsonResponse({ status: "ok" })
    case "idempotent_duplicate":
      return jsonResponse({ status: "duplicate" })
    case "conflict":
      return errorResponse(409, {
        error: ERR_CALLBACK_CONFLICT,
        problem: "A different result was already stored for this session.",
        cause: `previous_result_hash=${transition.previousResultHash}`,
      })
    case "not_found":
      return errorResponse(404, {
        error: ERR_SESSION_NOT_FOUND,
        problem: "No session with this id exists.",
      })
    case "not_pending":
      return errorResponse(409, {
        error: ERR_SESSION_NOT_PENDING,
        problem: `Session is already ${transition.currentStatus}.`,
      })
  }
}

async function failSession(store: SessionStore, sessionId: string, errorCode: string) {
  await store
    .transitionToTerminal({
      sessionId,
      status: "failed",
      errorCode,
    })
    .catch(() => undefined)
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

function invalidPayloadResponse(cause: string) {
  return errorResponse(400, {
    error: ERR_INVALID_CALLBACK_PAYLOAD,
    problem: "Callback body did not match the Wedge enrichment result schema.",
    cause,
    fix: "Post { session_id, status: \"ok\", result: { title, summary?, entity?, fields?, actions? } } to callback_url.",
  })
}

function missingSignatureResponse() {
  return errorResponse(400, {
    error: ERR_MISSING_SIG_PARAMS,
    problem: "Callback URL is missing one or more signature query params.",
    cause: "Required: sig, exp, nonce, kid.",
    fix: "Use the signed callback_url returned by /api/submit.",
  })
}

function signatureErrorResponse(reason: "expired" | "unknown_kid" | "invalid_signature") {
  const error =
    reason === "expired"
      ? ERR_SIGNATURE_EXPIRED
      : reason === "unknown_kid"
        ? ERR_UNKNOWN_KID
        : ERR_SIGNATURE_INVALID
  return errorResponse(403, {
    error,
    problem: "Callback signature could not be verified.",
    cause: reason,
    fix: "Use the callback_url returned by /api/submit and keep signing keys in sync.",
  })
}

function clientIp(c: Context<AppBindings>) {
  return (
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("cf-connecting-ip") ||
    "unknown"
  )
}
