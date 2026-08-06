import type { RuntimeEnv } from "../types"

export type WedgeCallbackConfig = {
  enrichment: {
    timeoutMs: number
  }
  security: {
    allowedOrigins: string[]
    rateLimitPerIpPerMinute: number
    sessionTtlSeconds: number
  }
  storage: {
    requirePersistent: boolean
  }
}

export function loadConfig(env: RuntimeEnv): WedgeCallbackConfig {
  const allowedOrigins = parseAllowedOrigins(env)
  const environment = env.WEDGE_CALLBACK_ENV || "production"

  return {
    enrichment: {
      timeoutMs: parsePositiveInt(process.env.WEDGE_CALLBACK_TIMEOUT_MS, 30_000),
    },
    security: {
      allowedOrigins,
      rateLimitPerIpPerMinute: parsePositiveInt(
        process.env.WEDGE_CALLBACK_RATE_LIMIT_PER_IP_PER_MINUTE,
        60
      ),
      sessionTtlSeconds: parsePositiveInt(process.env.WEDGE_CALLBACK_SESSION_TTL_SECONDS, 600),
    },
    storage: {
      requirePersistent:
        env.WEDGE_CALLBACK_REQUIRE_PERSISTENT_STORAGE === "true" ||
        (environment !== "development" && environment !== "test"),
    },
  }
}

function parseAllowedOrigins(env: RuntimeEnv) {
  const configured = splitCsv(env.WEDGE_CALLBACK_ALLOWED_ORIGINS)
  const railwayOrigin = env.RAILWAY_PUBLIC_DOMAIN ? [`https://${env.RAILWAY_PUBLIC_DOMAIN}`] : []
  const defaults =
    configured.length === 0
      ? ["http://localhost:8787", "http://127.0.0.1:8787"]
      : configured

  return [...new Set([...defaults, ...railwayOrigin])]
}

function splitCsv(value: string | undefined) {
  if (!value) {
    return []
  }

  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback
  }

  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}
