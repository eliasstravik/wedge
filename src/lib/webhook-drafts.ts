import type { WebhookConfig, WebhookDraft } from "./types"

const EMPTY_WEBHOOK_DRAFT: WebhookDraft = {
  name: "",
  deliveryMode: "direct",
  webhookUrl: "",
  authenticationToken: "",
  callbackBaseUrl: "",
  callbackDestinationId: "",
  isDefault: true,
}

export function createEmptyWebhookDraft(makeDefault: boolean): WebhookDraft {
  return {
    ...EMPTY_WEBHOOK_DRAFT,
    isDefault: makeDefault,
  }
}

export function toWebhookDraft(webhook: WebhookConfig | null): WebhookDraft {
  if (!webhook) {
    return { ...EMPTY_WEBHOOK_DRAFT }
  }

  return {
    id: webhook.id,
    name: webhook.name,
    deliveryMode: webhook.deliveryMode,
    webhookUrl: webhook.webhookUrl,
    authenticationToken: webhook.authenticationToken,
    callbackBaseUrl: webhook.callbackBaseUrl,
    callbackDestinationId: webhook.callbackDestinationId,
    isDefault: webhook.isDefault,
  }
}
