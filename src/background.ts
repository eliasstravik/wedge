import type { BackgroundRequest, BackgroundResponse, DeliveryInput } from "./lib/messages"
import {
  CLAY_WEBHOOK_AUTH_HEADER,
  clearCallbackSession,
  getAppState,
  markWebhookTestResult,
  markWebhookUsed,
  parseAndValidateCallbackBaseUrl,
  parseAndValidateUrl,
  pushHistory,
  randomId,
  updateCallbackSessionStatus,
  upsertCallbackSession,
} from "./lib/storage"
import type {
  CallbackResult,
  CallbackSessionState,
  CallbackSessionStatus,
  ErrorCode,
  HistoryEntry,
  WebhookConfig,
} from "./lib/types"

chrome.runtime.onMessage.addListener((message: BackgroundRequest, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) {
    return false
  }

  const fallbackError: BackgroundResponse = {
    ok: false,
    error: "Something went wrong. Close and reopen the extension.",
    errorCode: "NETWORK_ERROR",
  }

  if (message.type === "wedge/send") {
    void handleSend(message).then(sendResponse).catch(() => sendResponse(fallbackError))
    return true
  }

  if (message.type === "wedge/test-webhook") {
    void handleTestWebhook(message.webhookId).then(sendResponse).catch(() => sendResponse(fallbackError))
    return true
  }

  if (message.type === "wedge/poll-callback-session") {
    void handlePollCallbackSession(message.sessionId)
      .then(sendResponse)
      .catch(() => sendResponse(fallbackError))
    return true
  }

  if (message.type === "wedge/clear-callback-session") {
    void handleClearCallbackSession(message.sessionId)
      .then(sendResponse)
      .catch(() => sendResponse(fallbackError))
    return true
  }

  return false
})

async function handleSend(
  message: Extract<BackgroundRequest, { type: "wedge/send" }>
): Promise<BackgroundResponse> {
  const { webhooks } = await getAppState()
  const webhook = webhooks.find((entry) => entry.id === message.webhookId)

  if (!webhook) {
    return {
      ok: false,
      error: "Select a valid webhook before sending.",
      errorCode: "CONFIG_MISSING",
    }
  }

  return deliverAndTrack({
    webhook,
    payload: message.payload,
    pageTitle: message.pageTitle,
    pageHostname: message.pageHostname,
  })
}

async function handleTestWebhook(webhookId: string): Promise<BackgroundResponse> {
  const { webhooks } = await getAppState()
  const webhook = webhooks.find((entry) => entry.id === webhookId)

  if (!webhook) {
    return {
      ok: false,
      error: "Save the webhook before testing it.",
      errorCode: "CONFIG_MISSING",
    }
  }

  const payload = {
    test: true,
    source: "wedge_settings_test",
    sentAt: new Date().toISOString(),
    webhookName: webhook.name,
  }

  const response = await deliverAndTrack({
    webhook,
    payload,
  })

  const now = new Date().toISOString()
  await markWebhookTestResult(webhookId, response.ok ? "success" : "error", now)
  return response
}

async function deliverAndTrack(input: DeliveryInput): Promise<BackgroundResponse> {
  if (input.webhook.deliveryMode === "callback") {
    return deliverCallbackAndTrack(input)
  }

  const requestId = randomId()

  try {
    parseAndValidateUrl(input.webhook.webhookUrl)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid webhook URL."
    await safeRecordHistory(
      createHistoryEntry({
        webhook: input.webhook,
        status: "error",
        message,
        payloadPreview: JSON.stringify(input.payload).slice(0, 500),
        pageTitle: input.pageTitle,
        pageHostname: input.pageHostname,
        requestId,
        errorCode: "URL_INVALID",
      })
    )
    return { ok: false, error: message, errorCode: "URL_INVALID" }
  }

  const body = JSON.stringify(input.payload)

  if (body.length > 1_000_000) {
    const message = "Payload is too large (over 1 MB). Reduce the data before sending."
    await safeRecordHistory(
      createHistoryEntry({
        webhook: input.webhook,
        status: "error",
        message,
        payloadPreview: body.slice(0, 500),
        pageTitle: input.pageTitle,
        pageHostname: input.pageHostname,
        requestId,
        errorCode: "PAYLOAD_TOO_LARGE",
      })
    )
    return { ok: false, error: message, errorCode: "PAYLOAD_TOO_LARGE" }
  }

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-wedge-request-id": requestId,
    }

    if (input.webhook.authenticationToken.trim().length > 0) {
      headers[CLAY_WEBHOOK_AUTH_HEADER] = input.webhook.authenticationToken.trim()
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30_000)

    const response = await fetch(input.webhook.webhookUrl, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
      credentials: "omit",
    })

    clearTimeout(timeoutId)

    let responseSnippet = ""
    try {
      responseSnippet = await readResponseSnippet(response, 200)
    } catch {
      // Response body read failed — not critical, continue with empty snippet.
    }

    if (!response.ok) {
      const message = `Webhook returned ${response.status}. Check the webhook URL and token.`
      await safeRecordHistory(
        createHistoryEntry({
          webhook: input.webhook,
          status: "error",
          message,
          payloadPreview: body.slice(0, 500),
          pageTitle: input.pageTitle,
          pageHostname: input.pageHostname,
          requestId,
          errorCode: "HTTP_ERROR",
        })
      )
      return {
        ok: false,
        error: message,
        errorCode: "HTTP_ERROR",
        responseSnippet,
      }
    }

    // Webhook accepted — record success. Bookkeeping failures must not
    // change the response since the data was already delivered.
    try {
      const now = new Date().toISOString()
      await markWebhookUsed(input.webhook.id, now)
    } catch {
      // Storage write failed — non-critical.
    }
    await safeRecordHistory(
      createHistoryEntry({
        webhook: input.webhook,
        status: "sent",
        message: "Sent successfully.",
        payloadPreview: body.slice(0, 500),
        pageTitle: input.pageTitle,
        pageHostname: input.pageHostname,
        requestId,
      })
    )

    return {
      ok: true,
      requestId,
      message: "Sent successfully.",
      responseSnippet,
    }
  } catch (error) {
    const message =
      error instanceof Error
        ? `Network error: ${error.message}`
        : "Network error while sending to the webhook."

    await safeRecordHistory(
      createHistoryEntry({
        webhook: input.webhook,
        status: "error",
        message,
        payloadPreview: body.slice(0, 500),
        pageTitle: input.pageTitle,
        pageHostname: input.pageHostname,
        requestId,
        errorCode: "NETWORK_ERROR",
      })
    )

    return {
      ok: false,
      error: message,
      errorCode: "NETWORK_ERROR",
    }
  }
}

async function deliverCallbackAndTrack(input: DeliveryInput): Promise<BackgroundResponse> {
  const requestId = randomId()
  let callbackBaseUrl: string

  try {
    callbackBaseUrl = normalizeCallbackBaseUrl(input.webhook.callbackBaseUrl)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid callback API URL."
    await safeRecordHistory(
      createHistoryEntry({
        webhook: input.webhook,
        status: "error",
        message,
        payloadPreview: JSON.stringify(input.payload).slice(0, 500),
        pageTitle: input.pageTitle,
        pageHostname: input.pageHostname,
        requestId,
        errorCode: "URL_INVALID",
      })
    )
    return { ok: false, error: message, errorCode: "URL_INVALID" }
  }

  const body = JSON.stringify({
    lead: input.payload,
    ...(input.webhook.callbackDestinationId.trim()
      ? { destination_id: input.webhook.callbackDestinationId.trim() }
      : {}),
  })

  if (body.length > 1_000_000) {
    const message = "Payload is too large (over 1 MB). Reduce the data before sending."
    await safeRecordHistory(
      createHistoryEntry({
        webhook: input.webhook,
        status: "error",
        message,
        payloadPreview: body.slice(0, 500),
        pageTitle: input.pageTitle,
        pageHostname: input.pageHostname,
        requestId,
        errorCode: "PAYLOAD_TOO_LARGE",
      })
    )
    return { ok: false, error: message, errorCode: "PAYLOAD_TOO_LARGE" }
  }

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30_000)
    const response = await fetch(joinApiUrl(callbackBaseUrl, "/api/submit"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-wedge-request-id": requestId,
      },
      body,
      signal: controller.signal,
      credentials: "omit",
    })

    clearTimeout(timeoutId)

    let responseSnippet = ""
    try {
      responseSnippet = await readResponseSnippet(response, 200)
    } catch {
      // Response body read failed — not critical, continue with empty snippet.
    }

    if (!response.ok) {
      const message = `Callback API returned ${response.status}. Check the callback destination settings.`
      await safeRecordHistory(
        createHistoryEntry({
          webhook: input.webhook,
          status: "error",
          message,
          payloadPreview: body.slice(0, 500),
          pageTitle: input.pageTitle,
          pageHostname: input.pageHostname,
          requestId,
          errorCode: "HTTP_ERROR",
        })
      )
      return { ok: false, error: message, errorCode: "HTTP_ERROR", responseSnippet }
    }

    const parsed = parseSubmitResponse(responseSnippet)
    if (!parsed) {
      const message = "Callback API returned an unexpected session response."
      await safeRecordHistory(
        createHistoryEntry({
          webhook: input.webhook,
          status: "error",
          message,
          payloadPreview: body.slice(0, 500),
          pageTitle: input.pageTitle,
          pageHostname: input.pageHostname,
          requestId,
          errorCode: "HTTP_ERROR",
        })
      )
      return { ok: false, error: message, errorCode: "HTTP_ERROR", responseSnippet }
    }

    const now = new Date().toISOString()
    const callbackSession: CallbackSessionState = {
      sessionId: parsed.sessionId,
      readToken: parsed.readToken,
      expiresAt: parsed.expiresAt,
      webhookId: input.webhook.id,
      webhookName: input.webhook.name,
      callbackBaseUrl,
      destinationId: input.webhook.callbackDestinationId.trim() || "default",
      requestId,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    }

    await upsertCallbackSession(callbackSession)
    try {
      await markWebhookUsed(input.webhook.id, now)
    } catch {
      // Storage write failed — non-critical.
    }
    await safeRecordHistory(
      createHistoryEntry({
        webhook: input.webhook,
        status: "pending",
        message: "Sent to Wedge callback service.",
        payloadPreview: JSON.stringify(input.payload).slice(0, 500),
        pageTitle: input.pageTitle,
        pageHostname: input.pageHostname,
        requestId,
      })
    )

    return {
      ok: true,
      requestId,
      message: "Sent to Wedge callback service.",
      responseSnippet,
      callbackSession,
    }
  } catch (error) {
    const message =
      error instanceof Error
        ? `Network error: ${error.message}`
        : "Network error while sending to the callback API."

    await safeRecordHistory(
      createHistoryEntry({
        webhook: input.webhook,
        status: "error",
        message,
        payloadPreview: body.slice(0, 500),
        pageTitle: input.pageTitle,
        pageHostname: input.pageHostname,
        requestId,
        errorCode: "NETWORK_ERROR",
      })
    )

    return { ok: false, error: message, errorCode: "NETWORK_ERROR" }
  }
}

async function handlePollCallbackSession(sessionId: string): Promise<BackgroundResponse> {
  const { callbackSessions } = await getAppState()
  const session = callbackSessions.find((entry) => entry.sessionId === sessionId)

  if (!session) {
    return {
      ok: false,
      error: "Callback session was not found in local storage.",
      errorCode: "CONFIG_MISSING",
    }
  }

  try {
    const response = await fetch(joinApiUrl(session.callbackBaseUrl, `/api/session/${session.sessionId}?wait=1`), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${session.readToken}`,
      },
      credentials: "omit",
    })

    if (!response.ok) {
      return {
        ok: false,
        error: `Callback API returned ${response.status} while polling.`,
        errorCode: "HTTP_ERROR",
      }
    }

    const payload = parseSessionResponse(await response.json())
    if (!payload) {
      return {
        ok: false,
        error: "Callback API returned an unexpected polling response.",
        errorCode: "HTTP_ERROR",
      }
    }

    const nextSession = await updateCallbackSessionStatus(session.sessionId, payload)
    return {
      ok: true,
      requestId: session.requestId,
      message: callbackMessageFor(payload.status),
      callbackSession: nextSession ?? session,
    }
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? `Network error: ${error.message}`
          : "Network error while polling the callback API.",
      errorCode: "NETWORK_ERROR",
    }
  }
}

async function handleClearCallbackSession(sessionId: string): Promise<BackgroundResponse> {
  const cleared = await clearCallbackSession(sessionId)
  if (!cleared) {
    return {
      ok: false,
      error: "Callback session was not found in local storage.",
      errorCode: "CONFIG_MISSING",
    }
  }

  return {
    ok: true,
    requestId: cleared.requestId,
    message: "Result cleared.",
    callbackSession: cleared,
  }
}

async function safeRecordHistory(entry: HistoryEntry) {
  try {
    await pushHistory(entry)
  } catch {
    // Storage write failed — non-critical, don't let it change the delivery result.
  }
}

async function readResponseSnippet(response: Response, maxBytes: number) {
  if (!response.body) {
    return ""
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let result = ""

  try {
    while (result.length < maxBytes) {
      const { done, value } = await reader.read()
      if (done) break
      result += decoder.decode(value, { stream: true })
    }
  } finally {
    await reader.cancel()
  }

  return result.slice(0, maxBytes)
}

function createHistoryEntry({
  webhook,
  status,
  message,
  payloadPreview,
  pageTitle,
  pageHostname,
  requestId,
  errorCode,
}: {
  webhook: WebhookConfig
  status: HistoryEntry["status"]
  message: string
  payloadPreview?: string
  pageTitle?: string
  pageHostname?: string
  requestId: string
  errorCode?: ErrorCode
}): HistoryEntry {
  return {
    id: randomId(),
    at: new Date().toISOString(),
    status,
    webhookId: webhook.id,
    webhookName: webhook.name,
    payloadPreview,
    message,
    pageTitle,
    pageHostname,
    requestId,
    errorCode,
  }
}

function normalizeCallbackBaseUrl(value: string) {
  return parseAndValidateCallbackBaseUrl(value).toString().replace(/\/+$/, "")
}

function joinApiUrl(baseUrl: string, path: string) {
  const parsed = new URL(baseUrl)
  const [rawPathname, rawSearch] = path.split("?", 2)
  const cleanBasePath = parsed.pathname.replace(/\/+$/, "")
  const cleanPath = rawPathname.replace(/^\/+/, "")
  parsed.pathname = cleanBasePath ? `${cleanBasePath}/${cleanPath}` : `/${cleanPath}`
  parsed.search = rawSearch ? `?${rawSearch}` : ""
  return parsed.toString()
}

function parseSubmitResponse(bodyText: string) {
  try {
    const payload = JSON.parse(bodyText) as Record<string, unknown>
    if (
      typeof payload.session_id !== "string" ||
      typeof payload.read_token !== "string" ||
      typeof payload.expires_at !== "number"
    ) {
      return null
    }

    return {
      sessionId: payload.session_id,
      readToken: payload.read_token,
      expiresAt: payload.expires_at,
    }
  } catch {
    return null
  }
}

function parseSessionResponse(payload: unknown):
  | { status: "pending" }
  | { status: "ready"; result: CallbackResult }
  | { status: "failed"; errorCode: string }
  | { status: "expired" }
  | null {
  if (!payload || typeof payload !== "object") {
    return null
  }

  const object = payload as Record<string, unknown>
  if (object.status === "pending") {
    return { status: "pending" }
  }
  if (object.status === "expired") {
    return { status: "expired" }
  }
  if (object.status === "failed") {
    return {
      status: "failed",
      errorCode: typeof object.error_code === "string" ? object.error_code : "UNKNOWN",
    }
  }
  if (object.status === "ready" && object.result && typeof object.result === "object") {
    const result = object.result as CallbackResult
    if (typeof result.title === "string" && result.title.trim().length > 0) {
      return { status: "ready", result }
    }
  }

  return null
}

function callbackMessageFor(status: CallbackSessionStatus) {
  switch (status) {
    case "pending":
      return "Still waiting for Clay."
    case "ready":
      return "Enrichment result ready."
    case "failed":
      return "Callback session failed."
    case "expired":
      return "Callback session expired."
    case "cleared":
      return "Result cleared."
  }
}
