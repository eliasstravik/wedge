import { useRef, useState } from "react"
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
  GripVerticalIcon,
  MoreHorizontalIcon,
  PlusIcon,
  SearchIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { WebhookConfig } from "@/lib/types"

interface WebhooksListProps {
  webhooks: WebhookConfig[]
  onNewWebhook: () => void
  onEdit: (webhook: WebhookConfig) => void
  onDelete: (webhook: WebhookConfig) => void
  onDuplicate: (webhook: WebhookConfig) => void
  onExport: (webhook: WebhookConfig) => void
  onReorder: (orderedIds: string[]) => void
}

export function WebhooksList({
  webhooks,
  onNewWebhook,
  onEdit,
  onDelete,
  onDuplicate,
  onExport,
  onReorder,
}: WebhooksListProps) {
  const [search, setSearch] = useState("")

  const filtered = webhooks.filter(
    (w) =>
      w.name.toLowerCase().includes(search.toLowerCase()) ||
      w.webhookUrl.toLowerCase().includes(search.toLowerCase()) ||
      w.callbackBaseUrl.toLowerCase().includes(search.toLowerCase()) ||
      w.callbackDestinationId.toLowerCase().includes(search.toLowerCase())
  )

  const isFiltering = search.length > 0
  const ids = webhooks.map((w) => w.id)

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
    onReorder(reordered)
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <div className="relative max-w-xs flex-1">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/50" />
          <Input
            className="h-8 pl-8 text-sm"
            placeholder="Search webhooks..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex-1" />
        <Button onClick={onNewWebhook} size="sm">
          <PlusIcon data-icon="inline-start" />
          New webhook
        </Button>
      </div>

      {/* Table */}
      {filtered.length > 0 ? (
        <div className="overflow-hidden rounded-lg border">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={filtered.map((w) => w.id)} strategy={verticalListSortingStrategy}>
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-8" />
                    <TableHead>Name</TableHead>
                    <TableHead>URL</TableHead>
                    <TableHead className="w-16 text-center">Fields</TableHead>
                    <TableHead className="w-16 text-center">Auth</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((webhook) => (
                    <SortableRow
                      key={webhook.id}
                      webhook={webhook}
                      isDefault={webhook.isDefault}
                      isFiltering={isFiltering}
                      onEdit={onEdit}
                      onDelete={onDelete}
                      onDuplicate={onDuplicate}
                      onExport={onExport}
                    />
                  ))}
                </TableBody>
              </Table>
            </SortableContext>
          </DndContext>
        </div>
      ) : search ? (
        <div className="flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed py-12">
          <p className="text-sm font-medium">No results</p>
          <p className="text-sm text-muted-foreground">
            No webhooks match &ldquo;{search}&rdquo;
          </p>
        </div>
      ) : null}
    </div>
  )
}

function SortableRow({
  webhook,
  isDefault,
  isFiltering,
  onEdit,
  onDelete,
  onDuplicate,
  onExport,
}: {
  webhook: WebhookConfig
  isDefault: boolean
  isFiltering: boolean
  onEdit: (webhook: WebhookConfig) => void
  onDelete: (webhook: WebhookConfig) => void
  onDuplicate: (webhook: WebhookConfig) => void
  onExport: (webhook: WebhookConfig) => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: webhook.id, disabled: isFiltering })

  const hasAuth = webhook.deliveryMode === "direct" && Boolean(webhook.authenticationToken)
  const endpoint =
    webhook.deliveryMode === "callback"
      ? `${webhook.callbackBaseUrl}${webhook.callbackDestinationId ? ` · ${webhook.callbackDestinationId}` : " · default"}`
      : webhook.webhookUrl
  const skipNextClick = useRef(false)

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
  }

  function handleRowClick(e: React.MouseEvent) {
    if (skipNextClick.current) {
      skipNextClick.current = false
      return
    }
    if ((e.target as HTMLElement).closest("[data-no-row-click]")) return
    onEdit(webhook)
  }

  function menuAction(fn: () => void) {
    skipNextClick.current = true
    setTimeout(() => { skipNextClick.current = false }, 300)
    fn()
  }

  return (
    <TableRow
      ref={setNodeRef}
      style={style}
      className={`cursor-pointer ${
        isDragging ? "relative z-10 bg-card shadow-lg" : ""
      }`}
      onClick={handleRowClick}
    >
      {/* Drag handle */}
      <TableCell>
        <button
          data-no-row-click
          className="touch-none cursor-grab active:cursor-grabbing rounded p-0.5 text-muted-foreground/30 hover:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          {...attributes}
          {...listeners}
        >
          <GripVerticalIcon className="size-4" />
        </button>
      </TableCell>

      {/* Name */}
      <TableCell className="font-medium">
        <div className="flex items-center gap-2">
          <span className="truncate">{webhook.name}</span>
          {isDefault ? <Badge className="shrink-0 text-[10px]">Default</Badge> : null}
          {webhook.deliveryMode === "callback" ? (
            <Badge variant="secondary" className="shrink-0 text-[10px]">Callback</Badge>
          ) : null}
        </div>
      </TableCell>

      {/* URL */}
      <TableCell className="text-muted-foreground whitespace-normal break-all text-xs">
        {endpoint || <span className="italic text-sm">No URL</span>}
      </TableCell>

      {/* Fields */}
      <TableCell className="text-center">
        <Badge variant="secondary" className="tabular-nums">
          {webhook.fields.length}
        </Badge>
      </TableCell>

      {/* Auth */}
      <TableCell className="text-center">
        {webhook.deliveryMode === "callback" ? (
          <Badge variant="outline" className="text-[10px]">Server</Badge>
        ) : hasAuth ? (
          <Badge variant="outline" className="text-[10px]">Token</Badge>
        ) : (
          <span className="text-xs text-muted-foreground/50">—</span>
        )}
      </TableCell>

      {/* Actions */}
      <TableCell>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              data-no-row-click
              aria-label={`Actions for ${webhook.name}`}
              size="icon-xs"
              variant="ghost"
            >
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={() => menuAction(() => onEdit(webhook))}>Edit</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => menuAction(() => onDuplicate(webhook))}>Duplicate</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => menuAction(() => onExport(webhook))}>
                Export JSON
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => menuAction(() => onDelete(webhook))} variant="destructive">
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  )
}
