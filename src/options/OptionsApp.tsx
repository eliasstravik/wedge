import { startTransition, useEffect, useRef, useState } from "react"
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  AtSignIcon,
  CalendarIcon,
  CircleCheckIcon,
  CopyPlusIcon,
  DownloadIcon,
  FileJsonIcon,
  GripVerticalIcon,
  HashIcon,
  LinkIcon,
  LoaderCircleIcon,
  MoreHorizontalIcon,
  PlusIcon,
  SquareCheckIcon,
  Trash2Icon,
  TypeIcon,
  UploadIcon,
  WebhookIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

import { BrandLockup } from "@/components/brand-lockup"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSet,
  FieldLegend,
  FieldTitle,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Toaster } from "@/components/ui/sonner"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { getAppState, getHostname, saveUiState, saveWebhooks, setDefaultWebhook, upsertWebhook, removeWebhook } from "@/lib/storage"
import { createEmptyWebhookDraft, toWebhookDraft } from "@/lib/webhook-drafts"
import {
  BUILTIN_FIELD_DEFINITIONS,
  CUSTOM_FIELD_TYPE_LABELS,
  buildPayloadFromValues,
  createBuiltinField,
  createCustomField,
  createDefaultWebhookFields,
  createInitialFormValues,
  getFieldTypeLabel,
  getNextCustomFieldKey,
  getUnusedBuiltinKeys,
  toSnakeCase,
  toSnakeCaseLive,
} from "@/lib/webhook-fields"
import type {
  AppState,
  BuiltinFieldKey,
  CustomFieldType,
  PageSnapshot,
  WebhookConfig,
  WebhookDraft,
  WebhookFieldDraft,
} from "@/lib/types"
import {
  parseImportedWebhooks,
  validateWebhookDraft,
  validateWebhookFields,
} from "@/lib/validation"
import { WebhooksList } from "@/options/components/webhooks-list"

type EditorState =
  | { mode: "closed" }
  | { mode: "create" }
  | { mode: "edit"; webhookId: string }

type HashState = {
  mode?: string
  webhookId?: string
}

const EXAMPLE_PAGE: PageSnapshot = {
  url: "https://example.com/contact",
  title: "Example company",
  hostname: "example.com",
  context: {
    selectedText: "Intro paragraph",
    meta: {
      description: "Example description",
      canonical: "https://example.com/contact",
      ogTitle: "Example company",
    },
  },
}

const CUSTOM_FIELD_DATA_TYPES: CustomFieldType[] = [
  "short_text",
  "number",
  "date",
  "link",
  "email",
]

const CUSTOM_FIELD_CHOICE_TYPES: CustomFieldType[] = [
  "checkbox",
  "dropdown",
]

const CUSTOM_FIELD_DROPDOWN_LABELS: Partial<Record<CustomFieldType, string>> = {
  short_text: "Text",
}

const CUSTOM_FIELD_ICONS: Partial<Record<CustomFieldType, React.ReactNode>> = {
  short_text: <TypeIcon />,
  number: <HashIcon />,
  date: <CalendarIcon />,
  link: <LinkIcon />,
  email: <AtSignIcon />,
  checkbox: <SquareCheckIcon />,
  dropdown: <CircleCheckIcon />,
}

const CLOSED_EDITOR: EditorState = { mode: "closed" }

export function OptionsApp() {
  const [appState, setAppState] = useState<AppState | null>(null)
  const [editorState, setEditorState] = useState<EditorState>(CLOSED_EDITOR)
  const [webhookDraft, setWebhookDraft] = useState<WebhookDraft>(createEmptyWebhookDraft(true))
  const [fieldDrafts, setFieldDrafts] = useState<WebhookFieldDraft[]>(createDefaultWebhookFields())
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof WebhookDraft, string>>>({})
  const [fieldConfigError, setFieldConfigError] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState("")
  const [importError, setImportError] = useState<string | null>(null)
  const [pendingDeleteWebhook, setPendingDeleteWebhook] = useState<WebhookConfig | null>(null)
  const [pendingExport, setPendingExport] = useState<{ type: "all" } | { type: "single"; webhook: WebhookConfig } | null>(null)
  const [exportIncludeTokens, setExportIncludeTokens] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    void load()
  }, [])

  const webhooks = appState?.webhooks ?? []
  const currentWebhook =
    editorState.mode === "edit"
      ? webhooks.find((webhook) => webhook.id === editorState.webhookId) ?? null
      : null
  const hasWebhooks = webhooks.length > 0
  const unusedBuiltinKeys = getUnusedBuiltinKeys(fieldDrafts)
  const previewJson = JSON.stringify(
    buildPayloadFromValues(fieldDrafts, createInitialFormValues(fieldDrafts, EXAMPLE_PAGE)),
    null,
    2
  )

  async function load(preferredEditor?: EditorState) {
    setIsLoading(true)

    try {
      const state = await getAppState()
      const nextEditorState = resolveEditorState(state, preferredEditor)
      const nextWebhook =
        nextEditorState.mode === "edit"
          ? state.webhooks.find((webhook) => webhook.id === nextEditorState.webhookId) ?? null
          : null

      startTransition(() => {
        setAppState(state)
        setEditorState(nextEditorState)
        setWebhookDraft(
          nextWebhook
            ? toWebhookDraft(nextWebhook)
            : createEmptyWebhookDraft(state.webhooks.length === 0)
        )
        setFieldDrafts(nextWebhook ? cloneFields(nextWebhook.fields) : createDefaultWebhookFields())
        setFieldErrors({})
        setFieldConfigError(null)
        setImportError(null)
        setIsLoading(false)
      })
    } catch {
      setIsLoading(false)
      toast.error("Failed to load settings", {
        description: "Reload the page to try again.",
      })
    }
  }

  function openCreateEditor() {
    writeHashState({ mode: "create" })
    setEditorState({ mode: "create" })
    setWebhookDraft(createEmptyWebhookDraft(webhooks.length === 0))
    setFieldDrafts(createDefaultWebhookFields())
    setFieldErrors({})
    setFieldConfigError(null)
  }

  async function openEditEditor(webhook: WebhookConfig) {
    writeHashState({ webhookId: webhook.id })
    await saveUiState({ lastSelectedWebhookId: webhook.id })
    setEditorState({ mode: "edit", webhookId: webhook.id })
    setWebhookDraft(toWebhookDraft(webhook))
    setFieldDrafts(cloneFields(webhook.fields))
    setFieldErrors({})
    setFieldConfigError(null)
  }

  function closeEditor() {
    writeHashState({})
    setEditorState(CLOSED_EDITOR)
    setWebhookDraft(createEmptyWebhookDraft(webhooks.length === 0))
    setFieldDrafts(createDefaultWebhookFields())
    setFieldErrors({})
    setFieldConfigError(null)
  }

  async function handleSaveWebhook() {
    setIsSaving(true)
    setFieldErrors({})
    setFieldConfigError(null)

    const webhookResult = validateWebhookDraft(webhookDraft, currentWebhook ?? undefined)
    if (!webhookResult.ok) {
      setIsSaving(false)
      setFieldErrors(webhookResult.fieldErrors)
      toast.error("Fix the webhook details", {
        description: "Review the highlighted fields and save again.",
      })
      return
    }

    const fieldsResult = validateWebhookFields(fieldDrafts)
    if (!fieldsResult.ok) {
      setIsSaving(false)
      setFieldConfigError(fieldsResult.message)
      toast.error("Fix the payload fields", {
        description: fieldsResult.message,
      })
      return
    }

    const nextWebhook: WebhookConfig = {
      ...webhookResult.webhook,
      fields: fieldsResult.fields,
    }

    await upsertWebhook(nextWebhook)
    if (nextWebhook.isDefault) {
      await setDefaultWebhook(nextWebhook.id)
    }

    await saveUiState({ lastSelectedWebhookId: nextWebhook.id })
    setIsSaving(false)
    toast.success(currentWebhook ? "Webhook updated" : "Webhook created", {
      description: "The webhook is ready in the popup.",
    })
    await load(CLOSED_EDITOR)
  }

  async function handleDeleteWebhook(webhook: WebhookConfig) {
    await removeWebhook(webhook.id)
    setPendingDeleteWebhook(null)
    toast.success("Webhook deleted", {
      description: `${webhook.name} was removed from this browser.`,
    })
    await load(CLOSED_EDITOR)
  }

  async function handleMakeDefault(webhook: WebhookConfig) {
    await setDefaultWebhook(webhook.id)
    await saveUiState({ lastSelectedWebhookId: webhook.id })
    toast.success("Default webhook updated", {
      description: `${webhook.name} will open first in the popup.`,
    })
    await load(editorState.mode === "edit" ? editorState : CLOSED_EDITOR)
  }

  async function handleReorderWebhooks(orderedIds: string[]) {
    const byId = new Map(webhooks.map((w) => [w.id, w]))
    const reordered = orderedIds.map((id) => byId.get(id)).filter((w): w is WebhookConfig => Boolean(w))
    if (reordered.length !== webhooks.length) return

    const withDefault = reordered.map((w, i) => ({ ...w, isDefault: i === 0 }))
    await saveWebhooks(withDefault)
    await load(CLOSED_EDITOR)
  }

  async function handleDuplicateWebhook(webhook: WebhookConfig) {
    const duplicate: WebhookConfig = {
      ...structuredClone(webhook),
      id: crypto.randomUUID(),
      name: `${webhook.name} copy`,
      isDefault: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    await saveWebhooks([...webhooks, duplicate])
    toast.success("Webhook duplicated", {
      description: `${duplicate.name} was added.`,
    })
    await load(CLOSED_EDITOR)
  }

  async function handleImportWebhooks() {
    setIsImporting(true)
    setImportError(null)

    const result = parseImportedWebhooks(importText)
    if (!result.ok) {
      setIsImporting(false)
      setImportError(result.error)
      toast.error("Import failed", {
        description: result.error,
      })
      return
    }

    const imported = result.webhooks.map((webhook, index) => ({
      ...webhook,
      isDefault: webhooks.length === 0 && index === 0,
    }))

    await saveWebhooks([...webhooks, ...imported])
    setIsImporting(false)
    setImportOpen(false)
    setImportText("")
    toast.success("Webhooks imported", {
      description: `${imported.length} webhook${imported.length === 1 ? "" : "s"} added.`,
    })
    await load(CLOSED_EDITOR)
  }

  async function handleImportFileChange(file: File | null) {
    if (!file) {
      return
    }

    const MAX_IMPORT_FILE_SIZE = 512 * 1024
    if (file.size > MAX_IMPORT_FILE_SIZE) {
      setImportError("Import file is too large. Keep it under 512 KB.")
      setImportOpen(true)
      return
    }

    setImportText(await file.text())
    setImportOpen(true)
    setImportError(null)
  }

  function openExportAll() {
    if (webhooks.length === 0) return
    setExportIncludeTokens(false)
    setPendingExport({ type: "all" })
  }

  function openExportWebhook(webhook: WebhookConfig) {
    setExportIncludeTokens(false)
    // Defer so the dropdown menu fully closes before the dialog opens
    requestAnimationFrame(() => {
      setPendingExport({ type: "single", webhook })
    })
  }

  function confirmExport() {
    if (!pendingExport) return

    const toExport = pendingExport.type === "all" ? webhooks : [pendingExport.webhook]
    const sanitized = exportIncludeTokens
      ? toExport
      : toExport.map((w) => ({ ...w, authenticationToken: "" }))
    const filename = pendingExport.type === "all"
      ? "wedge-webhooks.json"
      : `wedge-${slugify(pendingExport.webhook.name)}.json`

    downloadJson(filename, JSON.stringify({ webhooks: sanitized }, null, 2))
    setPendingExport(null)
  }

  function addBuiltinField(builtinKey: BuiltinFieldKey) {
    setFieldDrafts((current) => [...current, createBuiltinField(builtinKey)])
  }

  function addCustomField(type: CustomFieldType) {
    setFieldDrafts((current) => [...current, createCustomField(type, current)])
  }

  function updateField(fieldId: string, updater: (field: WebhookFieldDraft) => WebhookFieldDraft) {
    setFieldDrafts((current) =>
      current.map((field) => (field.id === fieldId ? updater(field) : field))
    )
  }

  function moveField(fieldId: string, direction: -1 | 1) {
    setFieldDrafts((current) => {
      const index = current.findIndex((field) => field.id === fieldId)
      if (index < 0) {
        return current
      }

      const nextIndex = index + direction
      if (nextIndex < 0 || nextIndex >= current.length) {
        return current
      }

      const next = [...current]
      const [field] = next.splice(index, 1)
      next.splice(nextIndex, 0, field)
      return next
    })
  }

  function reorderFields(orderedIds: string[]) {
    setFieldDrafts((current) => {
      const byId = new Map(current.map((f) => [f.id, f]))
      return orderedIds.map((id) => byId.get(id)).filter((f): f is WebhookFieldDraft => Boolean(f))
    })
  }

  function removeField(fieldId: string) {
    setFieldDrafts((current) => current.filter((field) => field.id !== fieldId))
  }

  function duplicateField(fieldId: string) {
    setFieldDrafts((current) => {
      const index = current.findIndex((field) => field.id === fieldId)
      if (index < 0) {
        return current
      }

      const next = [...current]
      next.splice(index + 1, 0, createDuplicateField(current[index], current))
      return next
    })
  }

  return (
    <>
      <Toaster closeButton position="top-center" richColors />
      <input
        accept="application/json"
        className="sr-only"
        onChange={(event) => void handleImportFileChange(event.currentTarget.files?.[0] ?? null)}
        ref={fileInputRef}
        type="file"
      />
      <a
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-10 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
        href="#main-content"
      >
        Skip to main content
      </a>
      <main
        className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-8 px-4 py-8 sm:px-6"
        id="main-content"
      >
        {isLoading ? (
          <OptionsLoadingState />
        ) : editorState.mode === "closed" ? (
          <WebhooksIndexView
            fileInputRef={fileInputRef}
            hasWebhooks={hasWebhooks}
            importError={importError}
            importOpen={importOpen}
            importText={importText}
            isImporting={isImporting}
            onDeleteWebhook={setPendingDeleteWebhook}
            onDuplicateWebhook={(webhook) => void handleDuplicateWebhook(webhook)}
            onEditWebhook={(webhook) => void openEditEditor(webhook)}
            onExportAll={openExportAll}
            onExportWebhook={openExportWebhook}
            onFileDrop={(file) => void handleImportFileChange(file)}
            onImport={handleImportWebhooks}
            onImportTextChange={setImportText}
            onNewWebhook={openCreateEditor}
            onReorderWebhooks={(ids) => void handleReorderWebhooks(ids)}
            onOpenImport={() => setImportOpen((current) => !current)}
            webhooks={webhooks}
          />
        ) : (
          <WebhookEditorView
            currentWebhook={currentWebhook}
            fieldConfigError={fieldConfigError}
            fieldDrafts={fieldDrafts}
            fieldErrors={fieldErrors}
            isSaving={isSaving}
            onAddBuiltinField={addBuiltinField}
            onAddCustomField={addCustomField}
            onClose={closeEditor}
            onDuplicateField={duplicateField}
            onMoveField={moveField}
            onReorderFields={reorderFields}
            onRemoveField={removeField}
            onSave={() => void handleSaveWebhook()}
            onUpdateField={updateField}
            previewJson={previewJson}
            unusedBuiltinKeys={unusedBuiltinKeys}
            webhookDraft={webhookDraft}
            setWebhookDraft={setWebhookDraft}
          />
        )}
      </main>

      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            setPendingExport(null)
          }
        }}
        open={Boolean(pendingExport)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pendingExport?.type === "all"
                ? "Export all webhooks"
                : `Export ${pendingExport?.type === "single" ? pendingExport.webhook.name : "webhook"}`}
            </DialogTitle>
            <DialogDescription>
              The exported JSON file can be imported on another browser or shared with teammates.
            </DialogDescription>
          </DialogHeader>
          <label className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 cursor-pointer">
            <Checkbox
              checked={exportIncludeTokens}
              onCheckedChange={(checked) => setExportIncludeTokens(checked === true)}
              className="mt-0.5"
            />
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">Include authentication tokens</span>
              <span className="text-xs text-muted-foreground">
                Tokens are sensitive credentials. Only enable this if you trust everyone who will access the file.
              </span>
            </div>
          </label>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button onClick={confirmExport}>
              <DownloadIcon data-icon="inline-start" />
              Export
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        onOpenChange={(open) => {
          if (!open) {
            setPendingDeleteWebhook(null)
          }
        }}
        open={Boolean(pendingDeleteWebhook)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete webhook?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDeleteWebhook
                ? `This removes ${pendingDeleteWebhook.name} and its payload schema from this browser.`
                : "This removes the webhook from this browser."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingDeleteWebhook) {
                  void handleDeleteWebhook(pendingDeleteWebhook)
                }
              }}
            >
              Delete webhook
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function WebhooksIndexView({
  fileInputRef,
  hasWebhooks,
  importError,
  importOpen,
  importText,
  isImporting,
  onDeleteWebhook,
  onDuplicateWebhook,
  onEditWebhook,
  onExportAll,
  onExportWebhook,
  onFileDrop,
  onImport,
  onImportTextChange,
  onNewWebhook,
  onOpenImport,
  onReorderWebhooks,
  webhooks,
}: {
  fileInputRef: React.MutableRefObject<HTMLInputElement | null>
  hasWebhooks: boolean
  importError: string | null
  importOpen: boolean
  importText: string
  isImporting: boolean
  onDeleteWebhook: (webhook: WebhookConfig) => void
  onDuplicateWebhook: (webhook: WebhookConfig) => void
  onEditWebhook: (webhook: WebhookConfig) => void
  onExportAll: () => void
  onExportWebhook: (webhook: WebhookConfig) => void
  onFileDrop: (file: File) => void
  onImport: () => void
  onImportTextChange: (value: string) => void
  onNewWebhook: () => void
  onOpenImport: () => void
  onReorderWebhooks: (orderedIds: string[]) => void
  webhooks: WebhookConfig[]
}) {
  return (
    <>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-1">
            <BrandLockup className="mb-1" />
            <h1 className="text-xl font-semibold tracking-tight">Webhooks</h1>
            <p className="text-sm text-muted-foreground">
              Manage webhooks to send to Clay tables from the extension.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button disabled={!hasWebhooks} onClick={onExportAll} size="sm" variant="outline">
              <DownloadIcon data-icon="inline-start" />
              Export webhooks
            </Button>
            <Button onClick={onOpenImport} size="sm" variant="outline">
              <UploadIcon data-icon="inline-start" />
              Import webhooks
            </Button>
          </div>
        </div>

        {importOpen ? (
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Import webhook configs</h2>
              </CardTitle>
              <CardDescription>
                Paste one config or a <code>{`{"webhooks": [...]}`}</code> object to add multiple webhooks at once.
              </CardDescription>
              <CardAction>
                <Button aria-label="Close import" onClick={onOpenImport} size="icon-sm" type="button" variant="ghost">
                  <XIcon />
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                {importError ? (
                  <Alert variant="destructive">
                    <AlertTitle>Import failed</AlertTitle>
                    <AlertDescription>{importError}</AlertDescription>
                  </Alert>
                ) : null}
                <button
                  className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed py-10 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground data-[dragover=true]:border-primary/40 data-[dragover=true]:text-foreground"
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(event) => {
                    event.preventDefault()
                    event.currentTarget.dataset.dragover = "true"
                  }}
                  onDragLeave={(event) => {
                    delete event.currentTarget.dataset.dragover
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    delete event.currentTarget.dataset.dragover
                    const file = event.dataTransfer.files[0]
                    if (file) {
                      onFileDrop(file)
                    }
                  }}
                  type="button"
                >
                  <FileJsonIcon className="size-8" />
                  <span className="text-sm font-medium">Upload JSON file</span>
                  <span className="text-xs text-muted-foreground">
                    Or drag & drop a file, or paste JSON below
                  </span>
                </button>
                <Textarea
                  aria-invalid={Boolean(importError) || undefined}
                  aria-label="Import webhook JSON"
                  onChange={(event) => onImportTextChange(event.currentTarget.value)}
                  placeholder='Paste {"webhooks": [...]} JSON here'
                  rows={6}
                  value={importText}
                />
              </FieldGroup>
            </CardContent>
            <CardFooter className="justify-end gap-2">
              <Button disabled={isImporting || importText.trim().length === 0} onClick={onImport}>
                {isImporting ? (
                  <LoaderCircleIcon className="animate-spin" data-icon="inline-start" />
                ) : (
                  <UploadIcon data-icon="inline-start" />
                )}
                Import
              </Button>
            </CardFooter>
          </Card>
        ) : null}

        {hasWebhooks ? (
          <WebhooksList
            webhooks={webhooks}
            onNewWebhook={onNewWebhook}
            onEdit={onEditWebhook}
            onDelete={onDeleteWebhook}
            onDuplicate={onDuplicateWebhook}
            onExport={onExportWebhook}
            onReorder={onReorderWebhooks}
          />
        ) : (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <WebhookIcon />
              </EmptyMedia>
              <EmptyTitle>Add your first webhook</EmptyTitle>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={onNewWebhook}>
                <PlusIcon data-icon="inline-start" />
                New webhook
              </Button>
            </EmptyContent>
          </Empty>
        )}
      </div>
    </>
  )
}

function WebhookEditorView({
  currentWebhook,
  fieldConfigError,
  fieldDrafts,
  fieldErrors,
  isSaving,
  onAddBuiltinField,
  onAddCustomField,
  onClose,
  onDuplicateField,
  onMoveField,
  onReorderFields,
  onRemoveField,
  onSave,
  onUpdateField,
  previewJson,
  unusedBuiltinKeys,
  webhookDraft,
  setWebhookDraft,
}: {
  currentWebhook: WebhookConfig | null
  fieldConfigError: string | null
  fieldDrafts: WebhookFieldDraft[]
  fieldErrors: Partial<Record<keyof WebhookDraft, string>>
  isSaving: boolean
  onAddBuiltinField: (builtinKey: BuiltinFieldKey) => void
  onAddCustomField: (type: CustomFieldType) => void
  onClose: () => void
  onDuplicateField: (fieldId: string) => void
  onMoveField: (fieldId: string, direction: -1 | 1) => void
  onReorderFields: (orderedIds: string[]) => void
  onRemoveField: (fieldId: string) => void
  onSave: () => void
  onUpdateField: (fieldId: string, updater: (field: WebhookFieldDraft) => WebhookFieldDraft) => void
  previewJson: string
  unusedBuiltinKeys: BuiltinFieldKey[]
  webhookDraft: WebhookDraft
  setWebhookDraft: React.Dispatch<React.SetStateAction<WebhookDraft>>
}) {
  const pageTitle = currentWebhook ? "Edit webhook" : "Create webhook"
  const pageDescription = currentWebhook
    ? `Update ${currentWebhook.name} and its payload schema.`
    : "Set the webhook details first, then continue into the payload builder below."

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <button onClick={onClose} type="button">
                  Webhooks
                </button>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{currentWebhook?.name ?? "Create webhook"}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{pageTitle}</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">{pageDescription}</p>
        </div>
      </div>

      <FieldGroup>
        <Field data-invalid={Boolean(fieldErrors.name) || undefined}>
          <FieldLabel htmlFor="webhookName">Name</FieldLabel>
          <Input
            aria-invalid={Boolean(fieldErrors.name) || undefined}
            id="webhookName"
            onChange={(event) => {
              const value = event.currentTarget.value
              setWebhookDraft((current) => ({ ...current, name: value }))
            }}
            placeholder="Clay leads"
            value={webhookDraft.name}
          />
          <FieldError>{fieldErrors.name}</FieldError>
        </Field>

        <Field data-invalid={Boolean(fieldErrors.webhookUrl) || undefined}>
          <FieldLabel htmlFor="webhookUrl">Webhook URL</FieldLabel>
          <Input
            aria-invalid={Boolean(fieldErrors.webhookUrl) || undefined}
            id="webhookUrl"
            onChange={(event) => {
              const value = event.currentTarget.value
              setWebhookDraft((current) => ({ ...current, webhookUrl: value }))
            }}
            placeholder="https://api.clay.com/..."
            type="url"
            value={webhookDraft.webhookUrl}
          />
          <FieldDescription>Only HTTPS URLs are supported.</FieldDescription>
          <FieldError>{fieldErrors.webhookUrl}</FieldError>
        </Field>

        <Field data-invalid={Boolean(fieldErrors.authenticationToken) || undefined}>
          <FieldLabel htmlFor="authenticationToken">Authentication token</FieldLabel>
          <Input
            aria-invalid={Boolean(fieldErrors.authenticationToken) || undefined}
            id="authenticationToken"
            onChange={(event) => {
              const value = event.currentTarget.value
              setWebhookDraft((current) => ({ ...current, authenticationToken: value }))
            }}
            placeholder="Optional"
            type="password"
            value={webhookDraft.authenticationToken}
          />
          <FieldDescription>
            Optional. Stored locally in this browser.
          </FieldDescription>
          <FieldError>{fieldErrors.authenticationToken}</FieldError>
        </Field>
      </FieldGroup>

      <Separator />

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Payload builder</h2>
          </CardTitle>
          <CardDescription>
            Add built-in page fields or Tally-style custom inputs. Keys are saved in snake_case and shown exactly as they will be sent.
          </CardDescription>
          <CardAction>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline">
                  <PlusIcon data-icon="inline-start" />
                  Add field
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Built-in page fields</DropdownMenuLabel>
                <DropdownMenuGroup>
                  {unusedBuiltinKeys.length > 0 ? (
                    unusedBuiltinKeys.map((builtinKey) => (
                      <DropdownMenuItem key={builtinKey} onClick={() => onAddBuiltinField(builtinKey)}>
                        {BUILTIN_FIELD_DEFINITIONS[builtinKey].label}
                      </DropdownMenuItem>
                    ))
                  ) : (
                    <DropdownMenuItem disabled>All built-in fields already added</DropdownMenuItem>
                  )}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  {[...CUSTOM_FIELD_DATA_TYPES, ...CUSTOM_FIELD_CHOICE_TYPES].map((type) => (
                    <DropdownMenuItem key={type} onClick={() => onAddCustomField(type)}>
                      {CUSTOM_FIELD_ICONS[type]}
                      {CUSTOM_FIELD_DROPDOWN_LABELS[type] ?? CUSTOM_FIELD_TYPE_LABELS[type]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {fieldConfigError ? (
            <Alert variant="destructive">
              <AlertTitle>Payload schema needs attention</AlertTitle>
              <AlertDescription>{fieldConfigError}</AlertDescription>
            </Alert>
          ) : null}

          {fieldDrafts.length > 0 ? (
            <FieldDndList
              fieldDrafts={fieldDrafts}
              onDuplicateField={onDuplicateField}
              onMoveField={onMoveField}
              onReorderFields={onReorderFields}
              onRemoveField={onRemoveField}
              onUpdateField={onUpdateField}
            />
          ) : (
            <Empty className="border">
              <EmptyHeader>
                <EmptyTitle>Add your first payload field</EmptyTitle>
                <EmptyDescription>
                  Start with built-in page data or add a custom input block.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </CardContent>
      </Card>

      <Separator />

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Preview JSON</h2>
        <pre className="overflow-auto rounded-lg border bg-muted/40 p-4 text-xs leading-relaxed"><code>{previewJson}</code></pre>
        <p className="text-xs text-muted-foreground">Built-in fields use example values. Custom fields start empty.</p>
      </div>

      <div className="flex justify-end gap-2">
        <Button onClick={onClose} type="button" variant="outline">
          Cancel
        </Button>
        <Button disabled={isSaving} onClick={onSave}>
          {isSaving ? (
            <LoaderCircleIcon className="animate-spin" data-icon="inline-start" />
          ) : null}
          {currentWebhook ? "Save webhook" : "Add webhook"}
        </Button>
      </div>
    </div>
  )
}

function FieldDndList({
  fieldDrafts,
  onDuplicateField,
  onMoveField,
  onReorderFields,
  onRemoveField,
  onUpdateField,
}: {
  fieldDrafts: WebhookFieldDraft[]
  onDuplicateField: (fieldId: string) => void
  onMoveField: (fieldId: string, direction: -1 | 1) => void
  onReorderFields: (orderedIds: string[]) => void
  onRemoveField: (fieldId: string) => void
  onUpdateField: (fieldId: string, updater: (field: WebhookFieldDraft) => WebhookFieldDraft) => void
}) {
  const ids = fieldDrafts.map((f) => f.id)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = ids.indexOf(active.id as string)
    const newIndex = ids.indexOf(over.id as string)
    if (oldIndex < 0 || newIndex < 0) return
    const reordered = [...ids]
    const [moved] = reordered.splice(oldIndex, 1)
    reordered.splice(newIndex, 0, moved)
    onReorderFields(reordered)
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-4">
          {fieldDrafts.map((field, index) => (
            <FieldBuilderCard
              field={field}
              index={index}
              key={field.id}
              onDuplicate={onDuplicateField}
              onMove={onMoveField}
              onRemove={onRemoveField}
              onUpdate={onUpdateField}
              total={fieldDrafts.length}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}

function FieldBuilderCard({
  field,
  index,
  total,
  onUpdate,
  onMove,
  onDuplicate,
  onRemove,
}: {
  field: WebhookFieldDraft
  index: number
  total: number
  onUpdate: (fieldId: string, updater: (field: WebhookFieldDraft) => WebhookFieldDraft) => void
  onMove: (fieldId: string, direction: -1 | 1) => void
  onDuplicate: (fieldId: string) => void
  onRemove: (fieldId: string) => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: field.id })

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
  }

  return (
    <Card size="sm" ref={setNodeRef} style={style} className={isDragging ? "relative z-10 shadow-lg" : undefined}>
      <CardHeader>
        <CardTitle>
          <h3 className="flex items-center gap-2">
            <button
              className="touch-none cursor-grab active:cursor-grabbing -ml-1 rounded p-1 text-muted-foreground/40 hover:text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              {...attributes}
              {...listeners}
            >
              <GripVerticalIcon className="size-5" />
            </button>
            {field.label || "Untitled field"}
            {field.type === "builtin" ? (
              <Badge variant="outline" className="text-[10px] font-normal">Page data</Badge>
            ) : null}
          </h3>
        </CardTitle>
        <CardAction>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button aria-label={`Actions for ${field.label || "field"}`} size="icon-sm" variant="ghost">
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuItem disabled={index === 0} onClick={() => onMove(field.id, -1)}>
                  <ArrowUpIcon data-icon="inline-start" />
                  Move up
                </DropdownMenuItem>
                <DropdownMenuItem disabled={index === total - 1} onClick={() => onMove(field.id, 1)}>
                  <ArrowDownIcon data-icon="inline-start" />
                  Move down
                </DropdownMenuItem>
                {field.type !== "builtin" ? (
                  <DropdownMenuItem onClick={() => onDuplicate(field.id)}>
                    <CopyPlusIcon data-icon="inline-start" />
                    Duplicate
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onRemove(field.id)} variant="destructive">
                <Trash2Icon data-icon="inline-start" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {field.type === "builtin" ? (
          <>
            <div className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              <div>
                <span className="text-muted-foreground">JSON key</span>
                <p className="font-mono text-xs">{field.key}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Source</span>
                <p className="text-xs">Auto-filled from the active page</p>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{getFieldTypeLabel(field)}</Badge>
              {field.required ? <Badge>Required</Badge> : <Badge variant="secondary">Optional</Badge>}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={`${field.id}-label`}>Label</FieldLabel>
                <Input
                  id={`${field.id}-label`}
                  onChange={(event) => {
                    const value = event.currentTarget.value
                    onUpdate(field.id, (current) => ({ ...current, label: value }))
                  }}
                  value={field.label}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${field.id}-key`}>JSON key</FieldLabel>
                <Input
                  id={`${field.id}-key`}
                  onChange={(event) => {
                    const value = event.currentTarget.value
                    onUpdate(field.id, (current) => ({ ...current, key: toSnakeCaseLive(value) }))
                  }}
                  onBlur={() => {
                    onUpdate(field.id, (current) => ({ ...current, key: toSnakeCase(current.key) }))
                  }}
                  value={field.key}
                />
                <FieldDescription>Saved in snake_case.</FieldDescription>
              </Field>
            </div>

            <Field orientation="horizontal">
              <FieldContent>
                <FieldTitle>Required</FieldTitle>
                <FieldDescription>Block sending until this field has a value.</FieldDescription>
              </FieldContent>
              <Switch
                aria-label={`Mark ${field.label} as required`}
                checked={field.required}
                onCheckedChange={(checked) =>
                  onUpdate(field.id, (current) => ({
                    ...current,
                    required: checked,
                  }))
                }
              />
            </Field>

            {renderFieldConfiguration(field, onUpdate)}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function renderFieldConfiguration(
  field: WebhookFieldDraft,
  onUpdate: (fieldId: string, updater: (field: WebhookFieldDraft) => WebhookFieldDraft) => void
) {
  if (field.type === "builtin") {
    return null
  }

  if (field.type === "short_text" || field.type === "long_text") {
    return (
      <Field orientation="horizontal">
        <FieldContent>
          <FieldTitle>Long text</FieldTitle>
          <FieldDescription>Use a multi-line text area instead of a single-line input.</FieldDescription>
        </FieldContent>
        <Switch
          aria-label="Toggle long text"
          checked={field.type === "long_text"}
          onCheckedChange={(checked) =>
            onUpdate(field.id, (current) => ({
              ...current,
              type: checked ? "long_text" : "short_text",
            } as WebhookFieldDraft))
          }
        />
      </Field>
    )
  }

  if (field.type === "dropdown") {
    return (
      <Field>
        <FieldLabel htmlFor={`${field.id}-options`}>Options</FieldLabel>
        <Textarea
          id={`${field.id}-options`}
          onChange={(event) => {
            const nextOptions = linesToValues(event.currentTarget.value)

            onUpdate(field.id, (current) => ({
              ...current,
              options: nextOptions,
            } as WebhookFieldDraft))
          }}
          rows={6}
          value={field.options.join("\n")}
        />
        <FieldDescription>One option per line.</FieldDescription>
      </Field>
    )
  }

  return null
}

function OptionsLoadingState() {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-11 w-11 rounded-2xl" />
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-4 w-56" />
      </div>
      <div className="flex items-center gap-2">
        <Skeleton className="h-8 w-48 rounded-lg" />
        <div className="flex-1" />
        <Skeleton className="h-7 w-28 rounded-lg" />
      </div>
      <div className="overflow-hidden rounded-lg border">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full border-t" />
        <Skeleton className="h-14 w-full border-t" />
      </div>
    </div>
  )
}

function resolveEditorState(state: AppState, preferredEditor?: EditorState): EditorState {
  if (preferredEditor) {
    return normalizeEditorState(state, preferredEditor)
  }

  const hashState = readHashState()
  if (hashState.mode === "create") {
    return { mode: "create" }
  }

  if (hashState.webhookId) {
    return normalizeEditorState(state, { mode: "edit", webhookId: hashState.webhookId })
  }

  return CLOSED_EDITOR
}

function normalizeEditorState(state: AppState, editorState: EditorState): EditorState {
  if (editorState.mode !== "edit") {
    return editorState
  }

  return state.webhooks.some((webhook) => webhook.id === editorState.webhookId)
    ? editorState
    : CLOSED_EDITOR
}

function readHashState(): HashState {
  const params = new URLSearchParams(window.location.hash.slice(1))
  return {
    mode: params.get("mode") ?? undefined,
    webhookId: params.get("webhookId") ?? undefined,
  }
}

function writeHashState(nextState: HashState) {
  const params = new URLSearchParams()

  if (nextState.mode) {
    params.set("mode", nextState.mode)
  }

  if (nextState.webhookId) {
    params.set("webhookId", nextState.webhookId)
  }

  const hash = params.toString()
  window.history.replaceState(
    null,
    "",
    hash.length > 0 ? `${window.location.pathname}#${hash}` : window.location.pathname
  )
}

function cloneFields(fields: WebhookFieldDraft[]) {
  return structuredClone(fields)
}

function createDuplicateField(field: WebhookFieldDraft, fields: WebhookFieldDraft[]): WebhookFieldDraft {
  if (field.type === "builtin") {
    return createBuiltinField(field.builtinKey)
  }

  const duplicate = structuredClone(field)

  return {
    ...duplicate,
    id: crypto.randomUUID(),
    key: getNextCustomFieldKey(fields, field.type),
    label: `${field.label} copy`,
  }
}

function linesToValues(input: string) {
  return input.split("\n")
}

function downloadJson(filename: string, content: string) {
  const blob = new Blob([content], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

function slugify(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}
