import { startTransition, useEffect, useState } from "react"
import {
  CheckCircle2Icon,
  ChevronDownIcon,
  GlobeIcon,
  LoaderCircleIcon,
  PlusIcon,
  SendHorizonalIcon,
  WebhookIcon,
} from "lucide-react"
import { toast } from "sonner"

import { BrandLockup } from "@/components/brand-lockup"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import {
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Toaster } from "@/components/ui/sonner"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import type { BackgroundResponse } from "@/lib/messages"
import { getAppState, getHostname, getUiState, saveUiState } from "@/lib/storage"
import {
  BUILTIN_FIELD_DEFINITIONS,
  buildPayloadFromValues,
  createInitialFormValues,
  validateWebhookForm,
} from "@/lib/webhook-fields"
import type {
  AppState,
  PageContext,
  PageSnapshot,
  WebhookConfig,
  WebhookField,
  WebhookFormValues,
} from "@/lib/types"
import { cn } from "@/lib/utils"

const EMPTY_PAGE_CONTEXT: PageContext = {
  selectedText: "",
  meta: {
    description: "",
    canonical: "",
    ogTitle: "",
  },
}

type InlineStatus = {
  title: string
  description: string
  tone: "default" | "destructive"
}

export function PopupApp() {
  const [appState, setAppState] = useState<AppState | null>(null)
  const [currentTab, setCurrentTab] = useState<chrome.tabs.Tab | null>(null)
  const [pageContext, setPageContext] = useState<PageContext>(EMPTY_PAGE_CONTEXT)
  const [selectedWebhookId, setSelectedWebhookId] = useState("")
  const [formValues, setFormValues] = useState<WebhookFormValues>({})
  const [inlineStatus, setInlineStatus] = useState<InlineStatus | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isSending, setIsSending] = useState(false)
  const [hasAttemptedSend, setHasAttemptedSend] = useState(false)

  useEffect(() => {
    void load()
  }, [])

  const webhooks = appState?.webhooks ?? []
  const hasWebhooks = webhooks.length > 0
  const selectedWebhook =
    webhooks.find((webhook) => webhook.id === selectedWebhookId) ?? null
  const page = buildPageSnapshot(currentTab, pageContext)
  const isSupportedPage = page.url.startsWith("https://")
  const formErrors = selectedWebhook ? validateWebhookForm(selectedWebhook.fields, formValues) : {}
  const previewJson = selectedWebhook
    ? JSON.stringify(buildPayloadFromValues(selectedWebhook.fields, formValues), null, 2)
    : "{}"

  const sendDisabledReason = !hasWebhooks
    ? "Add a webhook in settings first."
    : !selectedWebhook
      ? "Choose a webhook before sending."
      : !isSupportedPage
        ? "Open a normal HTTPS page before sending."
        : selectedWebhook.fields.length === 0
          ? "Add payload fields in settings first."
          : Object.values(formErrors)[0] ?? null

  async function load(preferredWebhookId?: string) {
    setIsLoading(true)

    try {
      const [state, uiState, tab] = await Promise.all([getAppState(), getUiState(), getCurrentTab()])
      const nextPageContext = await getPageContext(tab)
      const nextPage = buildPageSnapshot(tab, nextPageContext)
      const nextSelectedWebhookId =
        preferredWebhookId ||
        uiState.lastSelectedWebhookId ||
        state.webhooks.find((webhook) => webhook.isDefault)?.id ||
        state.webhooks[0]?.id ||
        ""
      const nextWebhook =
        state.webhooks.find((webhook) => webhook.id === nextSelectedWebhookId) ?? null

      startTransition(() => {
        setAppState(state)
        setCurrentTab(tab)
        setPageContext(nextPageContext)
        setSelectedWebhookId(nextSelectedWebhookId)
        setFormValues(nextWebhook ? createInitialFormValues(nextWebhook.fields, nextPage) : {})
        setInlineStatus(null)
        setIsLoading(false)
      })
    } catch {
      setIsLoading(false)
      setInlineStatus({
        title: "Failed to load",
        description: "Close and reopen the popup to try again.",
        tone: "destructive",
      })
    }
  }

  async function handleSelectWebhook(value: string) {
    const nextWebhook = webhooks.find((webhook) => webhook.id === value) ?? null
    if (!nextWebhook) {
      return
    }

    setSelectedWebhookId(value)
    setFormValues(createInitialFormValues(nextWebhook.fields, page))
    setInlineStatus(null)
    setHasAttemptedSend(false)
    await saveUiState({ lastSelectedWebhookId: value })
  }

  async function handleSend() {
    if (!selectedWebhook) {
      return
    }

    setHasAttemptedSend(true)

    const errors = validateWebhookForm(selectedWebhook.fields, formValues)
    if (Object.keys(errors).length > 0) {
      setInlineStatus({
        title: "Complete the form",
        description: Object.values(errors)[0] ?? "Fill in the required fields before sending.",
        tone: "destructive",
      })
      return
    }

    setIsSending(true)
    setInlineStatus(null)

    try {
      const response = (await chrome.runtime.sendMessage({
        type: "wedge/send",
        webhookId: selectedWebhook.id,
        payload: buildPayloadFromValues(selectedWebhook.fields, formValues),
        pageTitle: page.title,
        pageHostname: page.hostname,
      })) as BackgroundResponse | undefined

      setIsSending(false)

      if (!response || !response.ok) {
        const errorMessage = response?.error ?? "No response from background. Try reopening the popup."
        setInlineStatus({
          title: "Send failed",
          description: errorMessage,
          tone: "destructive",
        })
        toast.error("Send failed", {
          description: errorMessage,
        })
        await load(selectedWebhook.id)
        return
      }

      setInlineStatus({
        title: "Sent to Clay",
        description: response.responseSnippet
          ? "The webhook accepted the payload."
          : "The current page was delivered successfully.",
        tone: "default",
      })
      toast.success("Sent to Clay", {
        description: response.message,
      })
      await load(selectedWebhook.id)
    } catch {
      setIsSending(false)
      setInlineStatus({
        title: "Send failed",
        description: "Could not reach the background service. Try reopening the popup.",
        tone: "destructive",
      })
      toast.error("Send failed", {
        description: "Could not reach the background service.",
      })
    }
  }

  function setFieldValue(fieldId: string, value: WebhookFormValues[string]) {
    setFormValues((current) => ({
      ...current,
      [fieldId]: value,
    }))
  }

  return (
    <>
      <Toaster closeButton position="top-center" richColors />
      <a
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-10 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
        href="#main-content"
      >
        Skip to main content
      </a>
      <main className="flex min-h-dvh w-[392px] flex-col gap-5 bg-background p-4" id="main-content">
        {isLoading ? (
          <PopupLoadingState />
        ) : !hasWebhooks ? (
          <>
            <BrandLockup subtitle="Chrome extension for sending data to Clay" />
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <WebhookIcon />
                </EmptyMedia>
                <EmptyTitle>Add your first webhook</EmptyTitle>
              </EmptyHeader>
              <EmptyContent>
                <Button onClick={() => void openSettingsPage("root")}>
                  <PlusIcon data-icon="inline-start" />
                  New webhook
                </Button>
              </EmptyContent>
            </Empty>
          </>
        ) : (
          <>
            <div className="flex items-start justify-between gap-3">
              <BrandLockup subtitle="Chrome extension for sending data to Clay." />
              <Button
                onClick={() => void openSettingsPage("root")}
                size="sm"
                variant="outline"
              >
                Manage webhooks
              </Button>
            </div>

            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="webhookSelect">Webhook</FieldLabel>
                <Select onValueChange={(value) => void handleSelectWebhook(value)} value={selectedWebhookId}>
                  <SelectTrigger id="webhookSelect" size="sm">
                    <SelectValue placeholder="Choose a webhook" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {webhooks.map((webhook) => (
                        <SelectItem key={webhook.id} value={webhook.id}>
                          {webhook.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel>Active page</FieldLabel>
                <div className="overflow-hidden rounded-lg border bg-muted/30 p-3">
                  <div className="flex items-start gap-3">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                      <GlobeIcon className="size-4" aria-hidden="true" />
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <p className="truncate text-sm font-medium">{page.title || "No active page"}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {page.hostname || "Waiting for an active browser tab"}
                      </p>
                    </div>
                  </div>
                </div>
              </Field>
            </FieldGroup>

            {selectedWebhook && selectedWebhook.fields.length > 0 ? (
              <FieldGroup>
                {selectedWebhook.fields.map((field) => (
                  <PopupField
                    error={hasAttemptedSend ? formErrors[field.id] : undefined}
                    field={field}
                    key={field.id}
                    onChange={(value) => setFieldValue(field.id, value)}
                    value={formValues[field.id]}
                  />
                ))}
              </FieldGroup>
            ) : null}

            <Collapsible onOpenChange={setPreviewOpen} open={previewOpen}>
              <CollapsibleTrigger asChild>
                <Button className="w-full justify-between" type="button" variant="ghost">
                  <span className="text-xs text-muted-foreground">JSON preview</span>
                  <ChevronDownIcon
                    className={cn("size-3.5 text-muted-foreground transition-transform", previewOpen && "rotate-180")}
                  />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2">
                <pre className="max-h-52 overflow-auto rounded-lg border bg-muted/40 p-3 text-xs leading-relaxed"><code>{previewJson}</code></pre>
              </CollapsibleContent>
            </Collapsible>

            {inlineStatus ? (
              <Alert aria-live="polite" variant={inlineStatus.tone}>
                <CheckCircle2Icon />
                <AlertTitle>{inlineStatus.title}</AlertTitle>
                <AlertDescription>{inlineStatus.description}</AlertDescription>
              </Alert>
            ) : null}

            <Button
              className="w-full"
              disabled={Boolean(sendDisabledReason) || isSending}
              onClick={() => void handleSend()}
              size="lg"
            >
              {isSending ? (
                <LoaderCircleIcon className="animate-spin" data-icon="inline-start" />
              ) : (
                <SendHorizonalIcon data-icon="inline-start" />
              )}
              Send webhook
            </Button>
          </>
        )}
      </main>
    </>
  )
}

function PopupField({
  field,
  value,
  error,
  onChange,
}: {
  field: WebhookField
  value: WebhookFormValues[string]
  error?: string
  onChange: (value: WebhookFormValues[string]) => void
}) {
  const star = field.required ? <span className="text-destructive"> *</span> : null

  if (field.type === "checkbox") {
    return (
      <Field orientation="horizontal" data-invalid={Boolean(error) || undefined}>
        <FieldLabel htmlFor={field.id}>{field.label}{star}</FieldLabel>
        <Switch
          id={field.id}
          checked={typeof value === "boolean" ? value : false}
          onCheckedChange={(checked) => onChange(checked)}
        />
        {error ? <FieldError>{error}</FieldError> : null}
      </Field>
    )
  }

  if (field.type === "dropdown") {
    return (
      <Field data-invalid={Boolean(error) || undefined}>
        <FieldLabel htmlFor={field.id}>{field.label}{star}</FieldLabel>
        <Select onValueChange={(nextValue) => onChange(nextValue)} value={typeof value === "string" ? value : ""}>
          <SelectTrigger aria-invalid={Boolean(error) || undefined} id={field.id}>
            <SelectValue placeholder="Choose an option" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {field.options.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <FieldError>{error}</FieldError>
      </Field>
    )
  }

  return (
    <Field data-invalid={Boolean(error) || undefined}>
      <FieldLabel htmlFor={field.id}>{field.label}{star}</FieldLabel>
      {isTextareaField(field) ? (
        <Textarea
          aria-invalid={Boolean(error) || undefined}
          id={field.id}
          onChange={(event) => onChange(event.currentTarget.value)}
          rows={field.type === "builtin" ? 4 : 5}
          value={typeof value === "string" ? value : ""}
        />
      ) : (
        <Input
          aria-invalid={Boolean(error) || undefined}
          id={field.id}
          onChange={(event) => onChange(event.currentTarget.value)}
          type={getInputType(field)}
          value={typeof value === "string" ? value : ""}
        />
      )}
      <FieldError>{error}</FieldError>
    </Field>
  )
}

function PopupLoadingState() {
  return (
    <div className="flex flex-1 flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-4 w-44" />
        </div>
        <Skeleton className="size-7" />
      </div>
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-32 w-full rounded-2xl" />
        <Skeleton className="h-16 w-full rounded-2xl" />
      </div>
    </div>
  )
}

function buildPageSnapshot(tab: chrome.tabs.Tab | null, pageContext: PageContext): PageSnapshot {
  const url = tab?.url ?? ""

  return {
    url,
    title: tab?.title ?? "",
    hostname: getHostname(url),
    context: pageContext,
  }
}

function isTextareaField(field: WebhookField) {
  if (field.type === "builtin") {
    return BUILTIN_FIELD_DEFINITIONS[field.builtinKey].inputType === "long_text"
  }

  return field.type === "long_text"
}

function getInputType(field: WebhookField) {
  if (field.type === "builtin") {
    return field.builtinKey === "url" || field.builtinKey === "canonical_url" ? "url" : "text"
  }

  switch (field.type) {
    case "number":
      return "number"
    case "email":
      return "email"
    case "link":
      return "url"
    case "date":
      return "date"
    default:
      return "text"
  }
}

async function getCurrentTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
  return tabs[0] ?? null
}

async function getPageContext(tab: chrome.tabs.Tab | null) {
  if (!tab?.id || !tab.url?.startsWith("https://")) {
    return EMPTY_PAGE_CONTEXT
  }

  try {
    return (await chrome.tabs.sendMessage(tab.id, {
      type: "wedge/capture",
    })) as PageContext
  } catch {
    return EMPTY_PAGE_CONTEXT
  }
}

async function openSettingsPage(target: "root" | "create" | { webhookId: string }) {
  const hash =
    target === "root"
      ? ""
      : target === "create"
        ? "#mode=create"
        : `#webhookId=${encodeURIComponent(target.webhookId)}`

  await chrome.tabs.create({
    url: chrome.runtime.getURL(`src/options/index.html${hash}`),
  })
}
