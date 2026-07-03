export type RuntimeEnv = {
  WEDGE_CALLBACK_ENV: "development" | "test" | "production" | string
  WEDGE_CALLBACK_SIGNING_KEY: string
  WEDGE_CALLBACK_SIGNING_KEY_PREVIOUS?: string
  WEDGE_CALLBACK_READ_KEY: string
  WEDGE_CALLBACK_ALLOWED_ORIGINS?: string
  WEDGE_CALLBACK_PUBLIC_URL?: string
  WEDGE_CALLBACK_DESTINATIONS?: string
  WEDGE_CALLBACK_REQUIRE_PERSISTENT_STORAGE?: string
  REDIS_URL?: string
  PORT?: string
  RAILWAY_PUBLIC_DOMAIN?: string
}

export type AppBindings = {
  Bindings: Record<string, never>
}
