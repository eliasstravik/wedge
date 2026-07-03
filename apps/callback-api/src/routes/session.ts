import { Hono } from "hono"
import type { Context } from "hono"

import type { AppBindings, RuntimeEnv } from "../types"
import type { WedgeCallbackConfig } from "../lib/config"
import type { SessionStore } from "../lib/session-store"
import {
  ERR_INVALID_AUTH,
  ERR_MISSING_AUTH,
  ERR_ORIGIN_NOT_ALLOWED,
  ERR_SESSION_NOT_FOUND,
  errorResponse,
  jsonResponse,
  withHeaders,
} from "../lib/errors"
import { checkOriginOrReferer, corsHeadersFor } from "../lib/origin"
import { hashReadToken } from "../lib/read-token"
import { timingSafeEqualText } from "../lib/signing"

const BEARER_PATTERN = /^Bearer\s+(\S+)\s*$/i
const LONG_POLL_MAX_MS = 25_000
const LONG_POLL_INTERVAL_MS = 250

export function sessionRoute(deps: {
  config: WedgeCallbackConfig
  env: RuntimeEnv
  store: SessionStore
}) {
  const app = new Hono<AppBindings>()

  app.get("/api/session/:sessionId", async (c) =>
    handleSession(c, deps.config, deps.env, deps.store)
  )

  return app
}

async function handleSession(
  c: Context<AppBindings>,
  config: WedgeCallbackConfig,
  env: RuntimeEnv,
  store: SessionStore
) {
  const allowedOrigin = checkOriginOrReferer(
    c.req.header("origin"),
    c.req.header("referer"),
    config.security.allowedOrigins
  )
  if (!allowedOrigin) {
    return errorResponse(403, {
      error: ERR_ORIGIN_NOT_ALLOWED,
      problem: "Origin header is missing or not in the allowed list.",
      fix: "Add the Chrome extension origin to WEDGE_CALLBACK_ALLOWED_ORIGINS.",
    })
  }

  const corsHeaders = corsHeadersFor(allowedOrigin, "session")
  const authHeader = c.req.header("authorization") ?? ""
  const match = BEARER_PATTERN.exec(authHeader)
  if (!match) {
    return withHeaders(
      errorResponse(401, {
        error: ERR_MISSING_AUTH,
        problem: "Missing or malformed Authorization header.",
        fix: "Send Authorization: Bearer <read_token> using the token returned by /api/submit.",
      }),
      corsHeaders
    )
  }

  const sessionId = c.req.param("sessionId")
  if (!sessionId) {
    return withHeaders(
      errorResponse(404, {
        error: ERR_SESSION_NOT_FOUND,
        problem: "Missing session_id in URL.",
      }),
      corsHeaders
    )
  }

  let record = await store.read(sessionId)
  if (!record) {
    return withHeaders(
      errorResponse(404, {
        error: ERR_SESSION_NOT_FOUND,
        problem: "No session with this id exists.",
        fix: "Submit again to obtain a fresh session.",
      }),
      corsHeaders
    )
  }

  const presentedHash = hashReadToken(match[1]!, env.WEDGE_CALLBACK_READ_KEY)
  if (!timingSafeEqualText(presentedHash, record.read_token_hash)) {
    return withHeaders(
      errorResponse(403, {
        error: ERR_INVALID_AUTH,
        problem: "The presented read_token does not match this session.",
        fix: "Poll with the read_token returned for this session_id.",
      }),
      corsHeaders
    )
  }

  if (parseWaitParam(c.req.query("wait")) && record.status === "pending") {
    const deadline = Date.now() + LONG_POLL_MAX_MS
    while (Date.now() < deadline) {
      await sleep(LONG_POLL_INTERVAL_MS)
      const next = await store.read(sessionId)
      if (!next) {
        break
      }
      record = next
      if (record.status !== "pending") {
        break
      }
    }
  }

  const response =
    record.status === "pending"
      ? { status: "pending" as const }
      : record.status === "ready"
        ? { status: "ready" as const, result: record.result_payload ?? null }
        : record.status === "failed"
          ? { status: "failed" as const, error_code: record.error_code ?? "UNKNOWN" }
          : { status: "expired" as const }

  return withHeaders(jsonResponse(response), corsHeaders)
}

function parseWaitParam(raw: string | undefined) {
  if (raw === undefined) {
    return false
  }
  const normalized = raw.toLowerCase()
  return normalized === "" || normalized === "1" || normalized === "true" || normalized === "yes"
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
