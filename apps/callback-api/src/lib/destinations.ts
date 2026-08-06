import { z } from "zod"

import type { RuntimeEnv } from "../types"

const HttpsUrl = z
  .string()
  .trim()
  .url()
  .refine((value) => new URL(value).protocol === "https:", "Destination webhook URLs must use HTTPS.")

const DestinationSchema = z
  .object({
    webhook_url: HttpsUrl,
    auth_token: z.string().trim().min(1).max(2000).optional(),
    headers: z.record(z.string().trim().min(1).max(80), z.string().trim().max(2000)).optional(),
  })
  .strict()

const DestinationsSchema = z.record(z.string().trim().min(1).max(120), DestinationSchema)

export type CallbackDestination = z.infer<typeof DestinationSchema> & {
  id: string
}

export class DestinationError extends Error {
  constructor(
    readonly code: "DESTINATIONS_INVALID" | "DESTINATION_NOT_FOUND",
    message: string
  ) {
    super(message)
    this.name = "DestinationError"
  }
}

export function resolveDestination(env: RuntimeEnv, requestedId: string | undefined): CallbackDestination {
  const destinations = parseDestinations(env.WEDGE_CALLBACK_DESTINATIONS)
  const destinationId = requestedId?.trim() || "default"
  const destination = destinations[destinationId] ?? destinations.default

  if (!destination) {
    throw new DestinationError(
      "DESTINATION_NOT_FOUND",
      `No callback destination is configured for '${destinationId}', and no default exists.`
    )
  }

  return { id: destinations[destinationId] ? destinationId : "default", ...destination }
}

export function getConfiguredDestinationIds(env: RuntimeEnv) {
  try {
    return Object.keys(parseDestinations(env.WEDGE_CALLBACK_DESTINATIONS))
  } catch {
    return []
  }
}

function parseDestinations(raw: string | undefined) {
  if (!raw || raw.trim().length === 0) {
    return {}
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new DestinationError(
      "DESTINATIONS_INVALID",
      error instanceof Error ? error.message : "Destination config is not valid JSON."
    )
  }

  const result = DestinationsSchema.safeParse(parsed)
  if (!result.success) {
    throw new DestinationError(
      "DESTINATIONS_INVALID",
      result.error.issues[0]?.message ?? "Destination config is invalid."
    )
  }

  return result.data
}
