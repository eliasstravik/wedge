import brandUrl from "@/assets/brand.png"
import { cn } from "@/lib/utils"

export function BrandLockup({
  className,
  subtitle = "Chrome extension for sending data to Clay",
}: {
  className?: string
  subtitle?: string
}) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className="relative flex size-11 items-center justify-center overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm">
        <img alt="" className="size-8" src={brandUrl} />
      </div>
      <div className="space-y-0.5">
        <p className="text-sm font-medium text-foreground">Wedge</p>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  )
}
