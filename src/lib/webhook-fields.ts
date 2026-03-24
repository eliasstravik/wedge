import { randomId } from "./storage"
import type {
  BuiltinFieldKey,
  CustomFieldType,
  PageSnapshot,
  WebhookField,
  WebhookFieldDraft,
  WebhookFieldValue,
  WebhookFormValues,
} from "./types"

type BuiltinFieldDefinition = {
  builtinKey: BuiltinFieldKey
  label: string
  key: string
  inputType: "short_text" | "long_text"
  description: string
}

export const BUILTIN_FIELD_DEFINITIONS: Record<BuiltinFieldKey, BuiltinFieldDefinition> = {
  url: {
    builtinKey: "url",
    label: "Page URL",
    key: "url",
    inputType: "short_text",
    description: "The active page URL.",
  },
  title: {
    builtinKey: "title",
    label: "Page title",
    key: "title",
    inputType: "short_text",
    description: "The current tab title.",
  },
  description: {
    builtinKey: "description",
    label: "Page description",
    key: "description",
    inputType: "long_text",
    description: "The page meta description when available.",
  },
  canonical_url: {
    builtinKey: "canonical_url",
    label: "Canonical URL",
    key: "canonical_url",
    inputType: "short_text",
    description: "The page canonical link when available.",
  },
  og_title: {
    builtinKey: "og_title",
    label: "Open Graph title",
    key: "og_title",
    inputType: "short_text",
    description: "The page og:title when available.",
  },
  selected_text: {
    builtinKey: "selected_text",
    label: "Selected text",
    key: "selected_text",
    inputType: "long_text",
    description: "The text currently selected on the page.",
  },
  hostname: {
    builtinKey: "hostname",
    label: "Hostname",
    key: "hostname",
    inputType: "short_text",
    description: "The active page hostname.",
  },
}

export const BUILTIN_FIELD_ORDER = Object.keys(
  BUILTIN_FIELD_DEFINITIONS
) as BuiltinFieldKey[]

export const CUSTOM_FIELD_TYPE_LABELS: Record<CustomFieldType, string> = {
  short_text: "Short text",
  long_text: "Long text",
  number: "Number",
  email: "Email",
  link: "URL",
  date: "Date",
  checkbox: "Checkbox",
  dropdown: "Select",
}

export function createDefaultWebhookFields() {
  return [
    createBuiltinField("url"),
    createBuiltinField("title"),
    createBuiltinField("description"),
  ]
}

export function createBuiltinField(builtinKey: BuiltinFieldKey): WebhookFieldDraft {
  const template = BUILTIN_FIELD_DEFINITIONS[builtinKey]

  return {
    id: randomId(),
    type: "builtin",
    builtinKey,
    key: template.key,
    label: template.label,
    required: builtinKey === "url",
  }
}

export function createCustomField(
  type: CustomFieldType,
  existingFields: WebhookField[]
): WebhookFieldDraft {
  const base = {
    id: randomId(),
    key: getNextCustomFieldKey(existingFields, type),
    label: CUSTOM_FIELD_TYPE_LABELS[type],
    required: false,
  }

  switch (type) {
    case "short_text":
    case "long_text":
    case "number":
    case "email":
    case "link":
    case "date":
      return { ...base, type, defaultValue: "" }
    case "dropdown":
      return {
        ...base,
        type,
        options: ["Option 1", "Option 2", "Option 3"],
        defaultValue: "",
      }
    case "checkbox":
      return { ...base, type, defaultValue: false }
  }
}

export function getBuiltinFieldValue(builtinKey: BuiltinFieldKey, page: PageSnapshot) {
  switch (builtinKey) {
    case "url":
      return page.url
    case "title":
      return page.title
    case "description":
      return page.context.meta.description
    case "canonical_url":
      return page.context.meta.canonical || page.url
    case "og_title":
      return page.context.meta.ogTitle || page.title
    case "selected_text":
      return page.context.selectedText
    case "hostname":
      return page.hostname
  }
}

export function getFieldInputKind(field: WebhookField) {
  if (field.type === "builtin") {
    return BUILTIN_FIELD_DEFINITIONS[field.builtinKey].inputType
  }

  return field.type
}

export function getInitialValueForField(field: WebhookField, page: PageSnapshot): WebhookFieldValue {
  if (field.type === "builtin") {
    return getBuiltinFieldValue(field.builtinKey, page)
  }

  return field.defaultValue
}

export function createInitialFormValues(fields: WebhookField[], page: PageSnapshot): WebhookFormValues {
  return Object.fromEntries(
    fields.map((field) => [field.id, getInitialValueForField(field, page)])
  )
}

export function buildPayloadFromValues(fields: WebhookField[], values: WebhookFormValues) {
  return Object.fromEntries(
    fields.map((field) => {
      if (field.hardcoded && field.type !== "builtin") {
        if (field.type === "checkbox") {
          return [field.key, field.defaultValue]
        }
        if (field.type === "number") {
          const v = typeof field.defaultValue === "string" ? field.defaultValue.trim() : ""
          return [field.key, v.length > 0 ? Number(v) : ""]
        }
        return [field.key, field.defaultValue]
      }

      const value = values[field.id]

      if (field.type === "checkbox") {
        return [field.key, typeof value === "boolean" ? value : false]
      }

      if (field.type === "number") {
        const normalizedValue = typeof value === "string" ? value.trim() : ""
        return [field.key, normalizedValue.length > 0 ? Number(normalizedValue) : ""]
      }

      return [field.key, typeof value === "string" ? value : ""]
    })
  )
}

export function buildProfilePayload(profileFields: WebhookField[]) {
  if (profileFields.length === 0) return undefined

  return Object.fromEntries(
    profileFields.map((field) => {
      if (field.type === "builtin") return [field.key, ""]
      if (field.type === "checkbox") return [field.key, field.defaultValue]
      if (field.type === "number") {
        const v = typeof field.defaultValue === "string" ? field.defaultValue.trim() : ""
        return [field.key, v.length > 0 ? Number(v) : ""]
      }
      return [field.key, typeof field.defaultValue === "string" ? field.defaultValue : ""]
    })
  )
}

export function validateWebhookForm(fields: WebhookField[], values: WebhookFormValues) {
  const errors: Record<string, string> = {}

  for (const field of fields) {
    if (field.hardcoded || !field.required) {
      continue
    }

    const value = values[field.id]

    if (field.type === "checkbox") {
      if (value !== true) {
        errors[field.id] = `${field.label} must be checked.`
      }
      continue
    }

    if (typeof value !== "string" || value.trim().length === 0) {
      errors[field.id] = `${field.label} is required.`
    }
  }

  return errors
}

export function getUnusedBuiltinKeys(fields: WebhookField[]) {
  const used = new Set(
    fields.filter((field) => field.type === "builtin").map((field) => field.builtinKey)
  )

  return BUILTIN_FIELD_ORDER.filter((builtinKey) => !used.has(builtinKey))
}

export function cloneFieldDraft(field: WebhookFieldDraft): WebhookFieldDraft {
  if (field.type === "dropdown") {
    return {
      ...field,
      id: randomId(),
      options: [...field.options],
    }
  }

  return { ...field, id: randomId() }
}

export function getFieldTypeLabel(field: WebhookField) {
  if (field.type === "builtin") {
    return "Built-in"
  }

  return CUSTOM_FIELD_TYPE_LABELS[field.type]
}

export function getNextCustomFieldKey(fields: WebhookField[], type: CustomFieldType) {
  const count = fields.filter((field) => field.type === type).length
  return `${type}_${count + 1}`
}

const PROFILE_DEFAULT_KEYS: Partial<Record<CustomFieldType, string>> = {
  short_text: "name",
  long_text: "notes",
  number: "number",
  email: "email",
  link: "link",
  date: "date",
  checkbox: "checkbox",
  dropdown: "dropdown",
}

export function createProfileField(
  type: CustomFieldType,
  existingFields: WebhookField[]
): WebhookFieldDraft {
  const baseKey = PROFILE_DEFAULT_KEYS[type] ?? type
  const usedKeys = new Set(existingFields.map((f) => f.key))
  let key = baseKey
  let n = 2
  while (usedKeys.has(key)) {
    key = `${baseKey}_${n}`
    n++
  }

  const label = key === baseKey
    ? baseKey.charAt(0).toUpperCase() + baseKey.slice(1)
    : `${baseKey.charAt(0).toUpperCase() + baseKey.slice(1)} ${n - 1}`

  const base = { id: randomId(), key, label, required: false, hardcoded: true as const }

  switch (type) {
    case "short_text":
    case "long_text":
    case "number":
    case "email":
    case "link":
    case "date":
      return { ...base, type, defaultValue: "" }
    case "dropdown":
      return { ...base, type, options: ["Option 1", "Option 2", "Option 3"], defaultValue: "" }
    case "checkbox":
      return { ...base, type, defaultValue: false }
  }
}

export function toSnakeCase(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

export function toSnakeCaseLive(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_+/, "")
}

