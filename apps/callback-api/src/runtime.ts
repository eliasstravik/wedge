import { randomUUID } from "node:crypto"

import { loadConfig } from "./lib/config"
import { createSessionStore } from "./lib/session-store"
import { MemoryRateLimiter } from "./lib/rate-limit"
import type { RuntimeEnv } from "./types"

export function loadRuntimeEnv(source: NodeJS.ProcessEnv = process.env): RuntimeEnv {
  return {
    WEDGE_CALLBACK_ENV: source.WEDGE_CALLBACK_ENV ?? "production",
    WEDGE_CALLBACK_SIGNING_KEY:
      source.WEDGE_CALLBACK_SIGNING_KEY ?? `ephemeral-signing-${randomUUID()}`,
    WEDGE_CALLBACK_SIGNING_KEY_PREVIOUS: source.WEDGE_CALLBACK_SIGNING_KEY_PREVIOUS,
    WEDGE_CALLBACK_READ_KEY: source.WEDGE_CALLBACK_READ_KEY ?? `ephemeral-read-${randomUUID()}`,
    WEDGE_CALLBACK_ALLOWED_ORIGINS: source.WEDGE_CALLBACK_ALLOWED_ORIGINS,
    WEDGE_CALLBACK_PUBLIC_URL: source.WEDGE_CALLBACK_PUBLIC_URL,
    WEDGE_CALLBACK_DESTINATIONS: source.WEDGE_CALLBACK_DESTINATIONS,
    WEDGE_CALLBACK_REQUIRE_PERSISTENT_STORAGE: source.WEDGE_CALLBACK_REQUIRE_PERSISTENT_STORAGE,
    REDIS_URL: source.REDIS_URL,
    PORT: source.PORT,
    RAILWAY_PUBLIC_DOMAIN: source.RAILWAY_PUBLIC_DOMAIN,
  }
}

export function createRuntime(source: NodeJS.ProcessEnv = process.env) {
  const env = loadRuntimeEnv(source)
  const config = loadConfig(env)
  const store = createSessionStore({ redisUrl: env.REDIS_URL })
  const rateLimiter = new MemoryRateLimiter()

  return { env, config, store, rateLimiter }
}
