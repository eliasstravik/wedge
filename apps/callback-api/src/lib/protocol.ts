import { z } from "zod"

export class ProtocolParseError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = "ProtocolParseError"
  }
}

const MAX_TITLE_LENGTH = 120
const MAX_SUMMARY_LENGTH = 800
const MAX_FIELD_COUNT = 20
const MAX_ACTION_COUNT = 5

const SafeText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => !/<\s*script\b/i.test(value), "Script tags are not allowed.")

const HttpsUrl = z
  .string()
  .trim()
  .url()
  .max(2048)
  .refine((value) => {
    try {
      return new URL(value).protocol === "https:"
    } catch {
      return false
    }
  }, "Only HTTPS URLs are allowed.")

const ResultEntity = z
  .object({
    name: SafeText(120).optional(),
    domain: z.string().trim().min(1).max(255).optional(),
    url: HttpsUrl.optional(),
    type: SafeText(60).optional(),
  })
  .strict()
  .refine((entity) => Object.keys(entity).length > 0, "Entity must include at least one field.")

const FieldValue = z.union([
  SafeText(500),
  z.number().finite(),
  z.boolean(),
  z.null(),
])

const ResultField = z
  .object({
    label: SafeText(80),
    value: FieldValue,
    type: z.enum(["text", "email", "url", "number", "boolean", "date"]).optional(),
    confidence: z.number().min(0).max(1).optional(),
    source_url: HttpsUrl.optional(),
  })
  .strict()

const OpenUrlAction = z
  .object({
    type: z.literal("open_url"),
    label: SafeText(80),
    url: HttpsUrl,
  })
  .strict()

const CopyValueAction = z
  .object({
    type: z.literal("copy_value"),
    label: SafeText(80),
    value: SafeText(1000),
  })
  .strict()

const ResultAction = z.discriminatedUnion("type", [OpenUrlAction, CopyValueAction])

export const EnrichmentResult = z
  .object({
    title: SafeText(MAX_TITLE_LENGTH),
    summary: SafeText(MAX_SUMMARY_LENGTH).optional(),
    entity: ResultEntity.optional(),
    fields: z.array(ResultField).max(MAX_FIELD_COUNT).optional(),
    actions: z.array(ResultAction).max(MAX_ACTION_COUNT).optional(),
  })
  .strict()

export const SuccessCallbackPayload = z
  .object({
    session_id: z.string().trim().min(1).max(120),
    status: z.literal("ok"),
    result: EnrichmentResult,
    meta: z
      .object({
        source: SafeText(80).optional(),
        enriched_at: z.string().trim().datetime({ offset: true }).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()

export const ErrorCallbackPayload = z
  .object({
    session_id: z.string().trim().min(1).max(120),
    status: z.literal("error"),
    error_code: z.string().trim().min(1).max(80),
    message: SafeText(500).optional(),
  })
  .strict()

export type EnrichmentResultPayload = z.infer<typeof EnrichmentResult>
export type SuccessCallback = z.infer<typeof SuccessCallbackPayload>
export type ErrorCallback = z.infer<typeof ErrorCallbackPayload>

export function parseSuccessCallback(input: unknown) {
  const parsed = SuccessCallbackPayload.safeParse(input)
  if (!parsed.success) {
    throw new ProtocolParseError("INVALID_CALLBACK_PAYLOAD", parsed.error.issues[0]?.message ?? "Invalid payload.")
  }
  return parsed.data
}

export function parseErrorCallback(input: unknown) {
  return ErrorCallbackPayload.safeParse(input)
}

export function stableResultHash(result: EnrichmentResultPayload) {
  return sha256Text(stableStringify(result))
}

async function sha256Text(input: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left.localeCompare(right)
  )
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(",")}}`
}
