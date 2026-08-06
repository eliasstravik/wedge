import type { CallbackSessionState, ErrorCode, PageContext, WebhookConfig } from "./types"

export interface BackgroundSuccess {
  ok: true
  requestId: string
  message: string
  responseSnippet?: string
  callbackSession?: CallbackSessionState
}

export interface BackgroundFailure {
  ok: false
  error: string
  errorCode?: ErrorCode
  responseSnippet?: string
}

export type BackgroundResponse = BackgroundSuccess | BackgroundFailure

export type BackgroundRequest =
  | {
      type: "wedge/send"
      webhookId: string
      payload: Record<string, unknown>
      pageTitle?: string
      pageHostname?: string
    }
  | {
      type: "wedge/test-webhook"
      webhookId: string
    }
  | {
      type: "wedge/poll-callback-session"
      sessionId: string
    }
  | {
      type: "wedge/clear-callback-session"
      sessionId: string
    }

export type ContentScriptRequest = { type: "wedge/capture" }
export type ContentScriptResponse = PageContext

export interface DeliveryInput {
  webhook: WebhookConfig
  payload: Record<string, unknown>
  pageTitle?: string
  pageHostname?: string
}
