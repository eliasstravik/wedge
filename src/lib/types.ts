export type HistoryStatus = "sent" | "error"
export type TestStatus = "idle" | "success" | "error"
export type ErrorCode =
  | "CONFIG_MISSING"
  | "URL_INVALID"
  | "FIELD_REQUIRED"
  | "NETWORK_ERROR"
  | "HTTP_ERROR"
  | "PAYLOAD_TOO_LARGE"

export type BuiltinFieldKey =
  | "url"
  | "title"
  | "description"
  | "canonical_url"
  | "og_title"
  | "selected_text"
  | "hostname"

export type BasicFieldType =
  | "short_text"
  | "long_text"
  | "number"
  | "email"
  | "link"
  | "date"

export type CustomFieldType =
  | BasicFieldType
  | "checkbox"
  | "dropdown"

export interface BaseWebhookField {
  id: string
  key: string
  label: string
  required: boolean
  hardcoded?: boolean
}

export interface BuiltinWebhookField extends BaseWebhookField {
  type: "builtin"
  builtinKey: BuiltinFieldKey
}

export interface BasicWebhookField extends BaseWebhookField {
  type: BasicFieldType
  defaultValue: string
}

export interface DropdownWebhookField extends BaseWebhookField {
  type: "dropdown"
  options: string[]
  defaultValue: string
}

export interface CheckboxWebhookField extends BaseWebhookField {
  type: "checkbox"
  defaultValue: boolean
}

export type WebhookField =
  | BuiltinWebhookField
  | BasicWebhookField
  | DropdownWebhookField
  | CheckboxWebhookField

export type WebhookFieldDraft = WebhookField

export interface WebhookConfig {
  id: string
  name: string
  webhookUrl: string
  authenticationToken: string
  isDefault: boolean
  fields: WebhookField[]
  createdAt: string
  updatedAt: string
  lastTestedAt?: string
  lastTestStatus?: TestStatus
  lastUsedAt?: string
}

export interface HistoryEntry {
  id: string
  at: string
  status: HistoryStatus
  webhookId?: string
  webhookName: string
  payloadPreview?: string
  message: string
  context?: string
  pageTitle?: string
  pageHostname?: string
  requestId?: string
  errorCode?: ErrorCode
}

export interface UIState {
  lastSelectedWebhookId?: string
}

export interface PageContextMeta {
  description: string
  canonical: string
  ogTitle: string
}

export interface PageContext {
  selectedText: string
  meta: PageContextMeta
}

export interface PageSnapshot {
  url: string
  title: string
  hostname: string
  context: PageContext
}

export type WebhookFieldValue = string | boolean
export type WebhookFormValues = Record<string, WebhookFieldValue | undefined>

export interface AppState {
  webhooks: WebhookConfig[]
  history: HistoryEntry[]
  uiState: UIState
}

export interface Diagnostics {
  webhooksCount: number
  historyCount: number
  schemaVersion: number
  extensionVersion: string
}

export interface WebhookDraft {
  id?: string
  name: string
  webhookUrl: string
  authenticationToken: string
  isDefault: boolean
}
