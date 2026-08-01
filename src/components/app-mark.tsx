import { Signal } from "lucide-react"

export function AppMark({ className = "" }: { className?: string }) {
  return (
    <div
      className={`grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground shadow-sm ${className}`}
      aria-hidden="true"
    >
      <Signal className="size-4" strokeWidth={2.4} />
    </div>
  )
}
