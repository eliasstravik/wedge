import { Hono } from "hono"

import type { AppBindings } from "./types"
import type { WedgeCallbackConfig } from "./lib/config"
import type { RateLimiter } from "./lib/rate-limit"
import type { SessionStore } from "./lib/session-store"
import type { RuntimeEnv } from "./types"
import { checkReadiness } from "./lib/readiness"
import { checkOrigin, corsHeadersFor } from "./lib/origin"
import { callbackRoute } from "./routes/callback"
import { sessionRoute } from "./routes/session"
import { submitRoute, type WebhookDispatcher } from "./routes/submit"
import { jsonResponse } from "./lib/errors"

export type AppDeps = {
  config: WedgeCallbackConfig
  env: RuntimeEnv
  store: SessionStore
  rateLimiter: RateLimiter
  dispatchWebhook?: WebhookDispatcher
}

export function createApp(deps: AppDeps) {
  const app = new Hono<AppBindings>()

  app.options("/api/submit", (c) => {
    const allowedOrigin = checkOrigin(c.req.header("origin"), deps.config.security.allowedOrigins)
    return new Response(null, {
      status: 204,
      headers: allowedOrigin ? corsHeadersFor(allowedOrigin, "submit") : undefined,
    })
  })

  app.options("/api/session/:sessionId", (c) => {
    const allowedOrigin = checkOrigin(c.req.header("origin"), deps.config.security.allowedOrigins)
    return new Response(null, {
      status: 204,
      headers: allowedOrigin ? corsHeadersFor(allowedOrigin, "session") : undefined,
    })
  })

  app.route("/", submitRoute(deps))
  app.route("/", callbackRoute(deps))
  app.route("/", sessionRoute(deps))

  app.get("/health", (c) => c.json({ status: "ok" }))
  app.get("/healthz", (c) => c.json({ status: "ok" }))
  app.get("/ready", () => {
    const readiness = checkReadiness(deps.config, deps.env, deps.store)
    return jsonResponse(
      readiness.ok
        ? {
            status: "ok",
            storage: readiness.storage,
            destinations: readiness.destinations,
          }
        : {
            status: "not_ready",
            problem: readiness.problem,
            fix: readiness.fix,
            storage: readiness.storage,
            destinations: readiness.destinations,
          },
      readiness.ok ? 200 : 503
    )
  })
  app.get("/", (c) =>
    c.json({
      name: "wedge-callback-api",
      status: "ok",
      kind: "backend",
      endpoints: {
        submit: "/api/submit",
        callback: "/api/callback/:sessionId",
        session: "/api/session/:sessionId",
        health: "/health",
        ready: "/ready",
      },
    })
  )

  app.notFound((c) =>
    c.json(
      {
        error: "NOT_FOUND",
        problem: `No route matched ${c.req.method} ${c.req.path}.`,
      },
      404
    )
  )

  return app
}
