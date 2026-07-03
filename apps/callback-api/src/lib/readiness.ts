import { getConfiguredDestinationIds } from "./destinations"
import type { WedgeCallbackConfig } from "./config"
import type { SessionStore } from "./session-store"
import type { RuntimeEnv } from "../types"

export type ReadinessResult =
  | {
      ok: true
      storage: { kind: SessionStore["kind"]; persistent: boolean; required: boolean }
      destinations: string[]
    }
  | {
      ok: false
      problem: string
      fix: string
      storage: { kind: SessionStore["kind"]; persistent: boolean; required: boolean }
      destinations: string[]
    }

export function checkReadiness(
  config: WedgeCallbackConfig,
  env: RuntimeEnv,
  store: SessionStore
): ReadinessResult {
  const storage = {
    kind: store.kind,
    persistent: store.kind === "redis",
    required: config.storage.requirePersistent,
  }
  const destinations = getConfiguredDestinationIds(env)

  if (config.storage.requirePersistent && store.kind !== "redis") {
    return {
      ok: false,
      problem: "Persistent session storage is required but Redis is not configured.",
      fix: "Set REDIS_URL or disable WEDGE_CALLBACK_REQUIRE_PERSISTENT_STORAGE for non-production local use.",
      storage,
      destinations,
    }
  }

  if (
    env.WEDGE_CALLBACK_ENV === "production" &&
    (env.WEDGE_CALLBACK_SIGNING_KEY.startsWith("ephemeral-") ||
      env.WEDGE_CALLBACK_READ_KEY.startsWith("ephemeral-"))
  ) {
    return {
      ok: false,
      problem: "Callback signing/read keys are not configured for production.",
      fix: "Set WEDGE_CALLBACK_SIGNING_KEY and WEDGE_CALLBACK_READ_KEY to stable secret values.",
      storage,
      destinations,
    }
  }

  if (destinations.length === 0) {
    return {
      ok: false,
      problem: "No callback destinations are configured.",
      fix: "Set WEDGE_CALLBACK_DESTINATIONS with a default destination or destination_id keyed entries.",
      storage,
      destinations,
    }
  }

  return { ok: true, storage, destinations }
}
