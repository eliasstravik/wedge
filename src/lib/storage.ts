import { BUILTIN_FIELD_DEFINITIONS, createDefaultWebhookFields, toSnakeCase } from "./webhook-fields"
import type {
  AppState,
  Diagnostics,
  ErrorCode,
  HistoryEntry,
  TestStatus,
  UIState,
  WebhookConfig,
  WebhookField,
} from "./types"

export const STORAGE_KEYS = {
  WEBHOOKS: "wedge.webhooks",
  HISTORY: "wedge.history",
  UI_STATE: "wedge.uiState",
  PROFILE: "wedge.profile",
  SCHEMA_VERSION: "wedge.schemaVersion",
} as const

const LEGACY_STORAGE_KEYS = {
  DESTINATIONS: "wedge.destinations",
} as const

export const CURRENT_SCHEMA_VERSION = 5
export const CLAY_WEBHOOK_AUTH_HEADER = "x-clay-webhook-auth"

export const DEFAULT_UI_STATE: UIState = {}

const EMPTY_HISTORY: HistoryEntry[] = []
const EMPTY_WEBHOOKS: WebhookConfig[] = []

const stateStorageKeys = [
  ...Object.values(STORAGE_KEYS),
  ...Object.values(LEGACY_STORAGE_KEYS),
]

export async function getAppState(): Promise<AppState> {
  const raw = await chrome.storage.local.get(stateStorageKeys)
  const normalized = normalizeStorage(raw)

  if (normalized.didChange) {
    await chrome.storage.local.set(normalized.persistable)
  }

  return normalized.state
}

export async function saveWebhooks(webhooks: WebhookConfig[]) {
  await chrome.storage.local.set({
    [STORAGE_KEYS.WEBHOOKS]: normalizeDefaultWebhook(webhooks),
  })
}

export async function saveHistory(history: HistoryEntry[]) {
  await chrome.storage.local.set({
    [STORAGE_KEYS.HISTORY]: history.slice(0, 100),
  })
}

export async function pushHistory(entry: HistoryEntry) {
  const { history } = await getAppState()
  await saveHistory([entry, ...history].slice(0, 100))
}

export async function saveUiState(uiState: Partial<UIState>) {
  const current = await getUiState()
  await chrome.storage.local.set({
    [STORAGE_KEYS.UI_STATE]: { ...current, ...uiState },
  })
}

export async function getUiState(): Promise<UIState> {
  const raw = await chrome.storage.local.get([STORAGE_KEYS.UI_STATE])
  return normalizeUiState(raw[STORAGE_KEYS.UI_STATE])
}

export async function saveProfileFields(fields: WebhookField[]) {
  await chrome.storage.local.set({
    [STORAGE_KEYS.PROFILE]: fields.length > 0 ? fields : [],
  })
}

export async function clearHistory() {
  await chrome.storage.local.set({ [STORAGE_KEYS.HISTORY]: [] })
}

export async function upsertWebhook(nextWebhook: WebhookConfig) {
  const { webhooks } = await getAppState()
  const exists = webhooks.some((webhook) => webhook.id === nextWebhook.id)
  const nextWebhooks = exists
    ? webhooks.map((webhook) => (webhook.id === nextWebhook.id ? nextWebhook : webhook))
    : [...webhooks, nextWebhook]

  await saveWebhooks(nextWebhooks)
}

export async function removeWebhook(webhookId: string) {
  const { webhooks } = await getAppState()
  await saveWebhooks(webhooks.filter((webhook) => webhook.id !== webhookId))
}

export async function setDefaultWebhook(webhookId: string) {
  const { webhooks } = await getAppState()
  await saveWebhooks(
    webhooks.map((webhook) => ({
      ...webhook,
      isDefault: webhook.id === webhookId,
    }))
  )
}

export async function markWebhookTestResult(webhookId: string, status: TestStatus, at: string) {
  const { webhooks } = await getAppState()
  await saveWebhooks(
    webhooks.map((webhook) =>
      webhook.id === webhookId
        ? { ...webhook, lastTestStatus: status, lastTestedAt: at, updatedAt: at }
        : webhook
    )
  )
}

export async function markWebhookUsed(webhookId: string, at: string) {
  const { webhooks } = await getAppState()
  await saveWebhooks(
    webhooks.map((webhook) =>
      webhook.id === webhookId ? { ...webhook, lastUsedAt: at } : webhook
    )
  )
}

export function getDiagnostics(state: AppState): Diagnostics {
  return {
    webhooksCount: state.webhooks.length,
    historyCount: state.history.length,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    extensionVersion: chrome.runtime.getManifest().version,
  }
}

export function maskToken(token: string) {
  if (!token) {
    return "Optional"
  }

  if (token.length <= 4) {
    return "••••"
  }

  return `••••••••${token.slice(-4)}`
}

export function parseAndValidateUrl(url: string) {
  let parsed: URL

  try {
    parsed = new URL(url)
  } catch {
    throw new Error("Enter a valid webhook URL.")
  }

  if (parsed.protocol.toLowerCase() !== "https:") {
    throw new Error("Use an HTTPS webhook URL.")
  }

  if (isBlockedHost(parsed.hostname)) {
    throw new Error("Webhook URLs pointing to localhost or private networks are not allowed.")
  }

  return parsed
}

const BLOCKED_IPV4_PATTERNS = [
  /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/,
  /^192\.168\.\d{1,3}\.\d{1,3}$/,
  /^0\.0\.0\.0$/,
  /^169\.254\.\d{1,3}\.\d{1,3}$/,
]

const BLOCKED_HOST_PATTERNS = [
  /^localhost$/i,
  ...BLOCKED_IPV4_PATTERNS,
  /^\[::1\]$/,
  /^\[::ffff:(?:127\.|10\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.)/i,
  /^\[f[cd]/i,
  /^\[fe80:/i,
  /\.local$/i,
]

function isBlockedHost(hostname: string) {
  if (BLOCKED_HOST_PATTERNS.some((pattern) => pattern.test(hostname))) {
    return true
  }

  // Browsers normalize IPv4-mapped IPv6 addresses to hex form:
  //   [::ffff:127.0.0.1] → [::ffff:7f00:1]
  // Extract the embedded IPv4 and re-check against blocked patterns.
  const mappedIPv4 = extractMappedIPv4(hostname)
  if (mappedIPv4) {
    return BLOCKED_IPV4_PATTERNS.some((pattern) => pattern.test(mappedIPv4))
  }

  return false
}

function extractMappedIPv4(hostname: string): string | null {
  const match = hostname.match(/^\[::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})\]$/i)
  if (!match) return null

  const high = parseInt(match[1], 16)
  const low = parseInt(match[2], 16)
  return `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`
}

export function byteLength(input: string) {
  return new TextEncoder().encode(input).length
}

export function randomId() {
  if (crypto.randomUUID) {
    return crypto.randomUUID()
  }

  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
}

export function getHostname(input?: string) {
  if (!input) {
    return ""
  }

  try {
    return new URL(input).hostname.replace(/^www\./, "")
  } catch {
    return ""
  }
}

function normalizeStorage(raw: Record<string, unknown>) {
  const webhooks = normalizeWebhooks(
    raw[STORAGE_KEYS.WEBHOOKS] ?? raw[LEGACY_STORAGE_KEYS.DESTINATIONS]
  )
  const history = normalizeHistory(raw[STORAGE_KEYS.HISTORY])
  const uiState = normalizeUiState(raw[STORAGE_KEYS.UI_STATE])
  const profileFields = normalizeProfileFields(raw[STORAGE_KEYS.PROFILE]) ?? []
  const schemaVersion = Number(raw[STORAGE_KEYS.SCHEMA_VERSION] ?? 0)
  const didChange =
    schemaVersion !== CURRENT_SCHEMA_VERSION ||
    raw[STORAGE_KEYS.WEBHOOKS] === undefined ||
    raw[STORAGE_KEYS.HISTORY] === undefined ||
    raw[STORAGE_KEYS.UI_STATE] === undefined

  const state: AppState = {
    webhooks,
    history,
    uiState,
    profileFields,
  }

  return {
    state,
    didChange,
    persistable: {
      [STORAGE_KEYS.WEBHOOKS]: webhooks,
      [STORAGE_KEYS.HISTORY]: history,
      [STORAGE_KEYS.UI_STATE]: uiState,
      [STORAGE_KEYS.PROFILE]: profileFields,
      [STORAGE_KEYS.SCHEMA_VERSION]: CURRENT_SCHEMA_VERSION,
    },
  }
}

function normalizeWebhooks(value: unknown): WebhookConfig[] {
  if (!Array.isArray(value)) {
    return EMPTY_WEBHOOKS
  }

  const items = value
    .map((entry) => normalizeWebhook(entry))
    .filter((entry): entry is WebhookConfig => entry !== null)

  return normalizeDefaultWebhook(items)
}

function normalizeWebhook(value: unknown): WebhookConfig | null {
  if (!value || typeof value !== "object") {
    return null
  }

  const item = value as Record<string, unknown>
  const id = asNonEmptyString(item.id) ?? randomId()
  const name = asNonEmptyString(item.name)
  const webhookUrl = asNonEmptyString(item.webhookUrl)
  const authenticationToken =
    asOptionalString(item.authenticationToken) ?? asOptionalString(item.authToken) ?? ""

  if (!name || !webhookUrl) {
    return null
  }

  return {
    id,
    name,
    webhookUrl,
    authenticationToken,
    isDefault: Boolean(item.isDefault),
    fields: normalizeFields(item.fields),
    createdAt: asIsoDate(item.createdAt),
    updatedAt: asIsoDate(item.updatedAt),
    lastTestedAt: asOptionalIsoDate(item.lastTestedAt),
    lastTestStatus: asTestStatus(item.lastTestStatus),
    lastUsedAt: asOptionalIsoDate(item.lastUsedAt),
  }
}

function normalizeFields(value: unknown): WebhookField[] {
  if (!Array.isArray(value)) {
    return createDefaultWebhookFields()
  }

  const fields = value
    .map((field) => normalizeField(field))
    .filter((field): field is WebhookField => field !== null)

  return fields.length > 0 ? fields : createDefaultWebhookFields()
}

function normalizeProfileFields(value: unknown): WebhookField[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined
  }

  const fields = value
    .map((field) => normalizeField(field))
    .filter((field): field is WebhookField => field !== null && field.type !== "builtin")

  return fields.length > 0 ? fields : undefined
}

function normalizeField(value: unknown): WebhookField | null {
  if (!value || typeof value !== "object") {
    return null
  }

  const item = value as Record<string, unknown>
  const id = asNonEmptyString(item.id) ?? randomId()
  const rawKey = asNonEmptyString(item.key)
  const label = asNonEmptyString(item.label)
  const required = Boolean(item.required)
  const hardcoded = item.hardcoded === true ? true : undefined
  const type = asOptionalString(item.type)

  if (!label || !type) {
    return null
  }

  const key = rawKey ? toSnakeCase(rawKey) : ""

  if (type === "builtin") {
    const builtinKey = asBuiltinFieldKey(item.builtinKey)

    if (!builtinKey) {
      return null
    }

    return {
      id,
      type,
      builtinKey,
      key: key || BUILTIN_FIELD_DEFINITIONS[builtinKey].key,
      label,
      required,
    }
  }

  if (!key) {
    return null
  }

  if (
    type === "short_text" ||
    type === "long_text" ||
    type === "number" ||
    type === "email" ||
    type === "link" ||
    type === "date"
  ) {
    return {
      id,
      type,
      key,
      label,
      required,
      hardcoded,
      defaultValue: asString(item.defaultValue),
    }
  }

  if (type === "dropdown" || type === "single_select") {
    const options = asStringArray(item.options)

    if (options.length === 0) {
      return null
    }

    return {
      id,
      type: "dropdown",
      key,
      label,
      required,
      hardcoded,
      options,
      defaultValue: asString(item.defaultValue),
    }
  }

  if (type === "checkbox") {
    return {
      id,
      type,
      key,
      label,
      required,
      hardcoded,
      defaultValue: typeof item.defaultValue === "boolean" ? item.defaultValue : false,
    }
  }

  return null
}

function normalizeHistory(value: unknown): HistoryEntry[] {
  if (!Array.isArray(value)) {
    return EMPTY_HISTORY
  }

  return value
    .map((entry) => normalizeHistoryEntry(entry))
    .filter((entry): entry is HistoryEntry => entry !== null)
    .slice(0, 100)
}

function normalizeHistoryEntry(value: unknown): HistoryEntry | null {
  if (!value || typeof value !== "object") {
    return null
  }

  const item = value as Record<string, unknown>
  const status = item.status === "error" ? "error" : item.status === "sent" ? "sent" : null
  const webhookName =
    asNonEmptyString(item.webhookName) ?? asNonEmptyString(item.destinationName)

  if (!status || !webhookName) {
    return null
  }

  return {
    id: asNonEmptyString(item.id) ?? randomId(),
    at: asIsoDate(item.at),
    status,
    webhookId: asOptionalString(item.webhookId) ?? asOptionalString(item.destinationId),
    webhookName,
    payloadPreview: asOptionalString(item.payloadPreview),
    message: asNonEmptyString(item.message) ?? "Completed",
    context: asOptionalString(item.context),
    pageTitle: asOptionalString(item.pageTitle),
    pageHostname: asOptionalString(item.pageHostname),
    requestId: asOptionalString(item.requestId),
    errorCode: asErrorCode(item.errorCode),
  }
}

function normalizeUiState(value: unknown): UIState {
  if (!value || typeof value !== "object") {
    return DEFAULT_UI_STATE
  }

  const item = value as Record<string, unknown>
  return {
    lastSelectedWebhookId:
      asOptionalString(item.lastSelectedWebhookId) ??
      asOptionalString(item.lastSelectedDestinationId),
  }
}

function normalizeDefaultWebhook(webhooks: WebhookConfig[]) {
  if (webhooks.length === 0) {
    return webhooks
  }

  const defaultId = webhooks.find((webhook) => webhook.isDefault)?.id ?? webhooks[0].id
  return webhooks.map((webhook) => ({
    ...webhook,
    isDefault: webhook.id === defaultId,
  }))
}

function asString(value: unknown) {
  return typeof value === "string" ? value : ""
}

function asOptionalString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function asNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

function asIsoDate(value: unknown) {
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) {
    return value
  }

  return new Date().toISOString()
}

function asOptionalIsoDate(value: unknown) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : undefined
}

function asBuiltinFieldKey(value: unknown) {
  if (value === "canonicalUrl") {
    return "canonical_url"
  }

  if (value === "ogTitle") {
    return "og_title"
  }

  if (value === "selectedText") {
    return "selected_text"
  }

  if (
    value === "url" ||
    value === "title" ||
    value === "description" ||
    value === "canonical_url" ||
    value === "og_title" ||
    value === "selected_text" ||
    value === "hostname"
  ) {
    return value
  }

  return undefined
}

function asTestStatus(value: unknown): TestStatus | undefined {
  if (value === "idle" || value === "success" || value === "error") {
    return value
  }

  return undefined
}

function asErrorCode(value: unknown): ErrorCode | undefined {
  if (
    value === "CONFIG_MISSING" ||
    value === "URL_INVALID" ||
    value === "FIELD_REQUIRED" ||
    value === "NETWORK_ERROR" ||
    value === "HTTP_ERROR" ||
    value === "PAYLOAD_TOO_LARGE"
  ) {
    return value
  }

  return undefined
}
