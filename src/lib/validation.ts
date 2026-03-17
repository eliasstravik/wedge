import { z } from "zod"

import {
  BUILTIN_FIELD_DEFINITIONS,
  toSnakeCase,
} from "./webhook-fields"
import { parseAndValidateUrl, randomId } from "./storage"
import type {
  BasicFieldType,
  BuiltinFieldKey,
  WebhookConfig,
  WebhookDraft,
  WebhookField,
  WebhookFieldDraft,
} from "./types"

const BASIC_FIELD_TYPES = [
  "short_text",
  "long_text",
  "number",
  "email",
  "link",
  "date",
] as const satisfies readonly BasicFieldType[]

const BUILTIN_FIELD_KEYS = [
  "url",
  "title",
  "description",
  "canonical_url",
  "og_title",
  "selected_text",
  "hostname",
] as const satisfies readonly BuiltinFieldKey[]

const webhookDraftSchema = z.object({
  id: z.string().optional(),
  name: z
    .string()
    .trim()
    .min(1, "Enter a webhook name.")
    .max(80, "Keep the webhook name under 80 characters."),
  webhookUrl: z
    .string()
    .trim()
    .min(1, "Enter a webhook URL.")
    .max(2048, "Keep the webhook URL under 2048 characters."),
  authenticationToken: z
    .string()
    .trim()
    .max(2000, "Keep the authentication token under 2000 characters."),
  isDefault: z.boolean(),
})

const baseFieldSchema = z.object({
  id: z.string().min(1),
  key: z.string().trim().min(1, "Add a JSON key."),
  label: z.string().trim().min(1, "Add a field label."),
  required: z.boolean(),
  hardcoded: z.boolean().optional(),
})

const builtinFieldSchema = baseFieldSchema.extend({
  type: z.literal("builtin"),
  builtinKey: z.enum(BUILTIN_FIELD_KEYS),
})

const basicFieldSchema = baseFieldSchema.extend({
  type: z.enum(BASIC_FIELD_TYPES),
  defaultValue: z.string(),
})

const dropdownFieldSchema = baseFieldSchema.extend({
  type: z.literal("dropdown"),
  options: z
    .array(z.string().trim().min(1, "Option labels cannot be empty."))
    .min(1, "Add at least one option."),
  defaultValue: z.string(),
})

const checkboxFieldSchema = baseFieldSchema.extend({
  type: z.literal("checkbox"),
  defaultValue: z.boolean(),
})

const webhookFieldSchema = z.discriminatedUnion("type", [
  builtinFieldSchema,
  basicFieldSchema,
  dropdownFieldSchema,
  checkboxFieldSchema,
])

const webhookConfigSchema = z.object({
  id: z.string(),
  name: z.string().trim().min(1),
  webhookUrl: z.string().trim().min(1),
  authenticationToken: z.string(),
  isDefault: z.boolean(),
  fields: z.array(webhookFieldSchema).min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastTestedAt: z.string().optional(),
  lastTestStatus: z.enum(["idle", "success", "error"]).optional(),
  lastUsedAt: z.string().optional(),
})

export type FieldErrors<T extends string> = Partial<Record<T, string>>

export function validateWebhookDraft(
  draft: WebhookDraft,
  existingWebhook?: WebhookConfig
) {
  const parsed = webhookDraftSchema.safeParse({
    ...draft,
    name: draft.name.trim(),
    webhookUrl: draft.webhookUrl.trim(),
    authenticationToken: draft.authenticationToken.trim(),
  })

  if (!parsed.success) {
    return {
      ok: false as const,
      fieldErrors: toFieldErrors(parsed.error.flatten().fieldErrors),
    }
  }

  try {
    parseAndValidateUrl(parsed.data.webhookUrl)
  } catch (error) {
    return {
      ok: false as const,
      fieldErrors: {
        webhookUrl: error instanceof Error ? error.message : "Enter a valid webhook URL.",
      },
    }
  }

  const now = new Date().toISOString()

  return {
    ok: true as const,
    webhook: {
      id: parsed.data.id ?? existingWebhook?.id ?? randomId(),
      name: parsed.data.name,
      webhookUrl: parsed.data.webhookUrl,
      authenticationToken: parsed.data.authenticationToken,
      isDefault: parsed.data.isDefault,
      fields: existingWebhook?.fields ?? [],
      createdAt: existingWebhook?.createdAt ?? now,
      updatedAt: now,
      lastTestStatus: existingWebhook?.lastTestStatus ?? "idle",
      lastTestedAt: existingWebhook?.lastTestedAt,
      lastUsedAt: existingWebhook?.lastUsedAt,
    },
  }
}

export function validateWebhookFields(fields: WebhookFieldDraft[]) {
  if (fields.length === 0) {
    return {
      ok: false as const,
      message: "Add at least one field to the webhook payload.",
    }
  }

  const parsedFields: WebhookField[] = []

  for (const field of fields) {
    const parsed = webhookFieldSchema.safeParse(field)

    if (!parsed.success) {
      return {
        ok: false as const,
        message: parsed.error.issues[0]?.message ?? "Fix the field configuration.",
      }
    }

    const normalizedField = normalizeFieldDefaults(parsed.data)

    if (normalizedField.key.length === 0) {
      return {
        ok: false as const,
        message: `Use letters or numbers in the JSON key for ${normalizedField.label}.`,
      }
    }

    parsedFields.push(normalizedField)
  }

  const normalizedKeys = parsedFields.map((field) => field.key)
  const uniqueKeys = new Set(normalizedKeys)

  if (uniqueKeys.size !== normalizedKeys.length) {
    return {
      ok: false as const,
      message: "Each payload field needs a unique JSON key.",
    }
  }

  return {
    ok: true as const,
    fields: parsedFields,
  }
}

export function parseImportedWebhooks(input: string) {
  let parsedJson: unknown

  try {
    parsedJson = JSON.parse(input)
  } catch {
    return {
      ok: false as const,
      error: "Paste valid JSON to import webhook configs.",
    }
  }

  const nestedWebhooks =
    parsedJson && typeof parsedJson === "object"
      ? (parsedJson as { webhooks?: unknown[] }).webhooks
      : undefined
  const MAX_IMPORT_COUNT = 50
  const rawCandidates: unknown[] = Array.isArray(parsedJson)
    ? parsedJson
    : Array.isArray(nestedWebhooks)
      ? nestedWebhooks
      : [parsedJson]

  if (rawCandidates.length > MAX_IMPORT_COUNT) {
    return {
      ok: false as const,
      error: `Import up to ${MAX_IMPORT_COUNT} webhooks at a time.`,
    }
  }

  const candidates = rawCandidates.slice(0, MAX_IMPORT_COUNT)
  const nextWebhooks: WebhookConfig[] = []

  for (const candidate of candidates) {
    const result = webhookConfigSchema.safeParse(candidate)

    if (!result.success) {
      return {
        ok: false as const,
        error: result.error.issues[0]?.message ?? "One imported webhook is invalid.",
      }
    }

    try {
      parseAndValidateUrl(result.data.webhookUrl)
    } catch (error) {
      return {
        ok: false as const,
        error: error instanceof Error ? error.message : "One imported webhook URL is invalid.",
      }
    }

    const fieldsResult = validateWebhookFields(result.data.fields)
    if (!fieldsResult.ok) {
      return {
        ok: false as const,
        error: fieldsResult.message,
      }
    }

    const now = new Date().toISOString()

    nextWebhooks.push({
      ...result.data,
      id: randomId(),
      fields: fieldsResult.fields,
      isDefault: false,
      createdAt: now,
      updatedAt: now,
      lastTestStatus: "idle",
      lastTestedAt: undefined,
      lastUsedAt: undefined,
    })
  }

  if (nextWebhooks.length === 0) {
    return {
      ok: false as const,
      error: "No webhook configs were found in the import payload.",
    }
  }

  return {
    ok: true as const,
    webhooks: nextWebhooks,
  }
}

function normalizeFieldDefaults(field: WebhookField): WebhookField {
  const normalizedKey = field.type === "builtin"
    ? normalizeBuiltinKey(field.builtinKey, field.key)
    : toSnakeCase(field.key)

  if (field.type === "builtin") {
    return {
      ...field,
      key: normalizedKey,
      label: field.label.trim(),
    }
  }

  if (isBasicField(field)) {
    return {
      ...field,
      key: normalizedKey,
      label: field.label.trim(),
      defaultValue: field.defaultValue.trim(),
    }
  }

  if (field.type === "dropdown") {
    const options = dedupeOptions(field.options)

    return {
      ...field,
      key: normalizedKey,
      label: field.label.trim(),
      options,
      defaultValue: options.includes(field.defaultValue.trim()) ? field.defaultValue.trim() : "",
    }
  }

  if (field.type === "checkbox") {
    return {
      ...field,
      key: normalizedKey,
      label: field.label.trim(),
    }
  }

  return field
}

function normalizeBuiltinKey(builtinKey: BuiltinFieldKey, key: string) {
  return toSnakeCase(key) || BUILTIN_FIELD_DEFINITIONS[builtinKey].key
}

function isBasicField(
  field: WebhookField
): field is Extract<
  WebhookField,
  {
    type:
      | "short_text"
      | "long_text"
      | "number"
      | "email"
      | "link"
      | "date"
  }
> {
  return (
    field.type === "short_text" ||
    field.type === "long_text" ||
    field.type === "number" ||
    field.type === "email" ||
    field.type === "link" ||
    field.type === "date"
  )
}

function dedupeOptions(options: string[]) {
  return [...new Set(options.map((option) => option.trim()).filter((option) => option.length > 0))]
}

function toFieldErrors<T extends string>(fieldErrors: Partial<Record<T, string[] | undefined>>) {
  return Object.fromEntries(
    Object.entries(fieldErrors)
      .filter(([, value]) => Array.isArray(value) && value.length > 0)
      .map(([key, value]) => [key, (Array.isArray(value) ? value[0] : undefined) ?? "Invalid value."])
  ) as FieldErrors<T>
}
