import { Skeleton } from "@/components/ui/skeleton"

export default function ConversationsLoading() {
  return (
    <div className="flex h-[calc(100svh-3.5rem)] overflow-hidden">
      {/* Column 1 — inbox switcher rail (hidden on mobile) */}
      <div className="hidden w-16 shrink-0 flex-col items-center gap-2 border-r border-border bg-card py-3 sm:flex">
        <Skeleton className="h-10 w-10 rounded-xl" />
        <div className="my-1 h-px w-8 bg-border" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-10 rounded-xl" />
        ))}
      </div>

      {/* Column 2 — conversation list */}
      <div className="flex w-full flex-col border-r border-border bg-card sm:w-[300px] sm:shrink-0">
        {/* Header */}
        <div className="space-y-3 border-b border-border p-3">
          <div className="flex items-center justify-between">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-8 w-16 rounded-md" />
          </div>
          <Skeleton className="h-9 w-full rounded-lg" />
        </div>

        {/* List */}
        <div className="flex-1 space-y-1 overflow-hidden p-2">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="flex items-start gap-3 px-1 py-2">
              <div className="min-w-0 flex-1 space-y-2 py-1">
                <Skeleton className="h-3.5 w-2/5" />
                <Skeleton className="h-3 w-4/5" />
              </div>
              <Skeleton className="h-3 w-10 shrink-0" />
            </div>
          ))}
        </div>
      </div>

      {/* Column 3 — chat empty placeholder (hidden on mobile) */}
      <div className="hidden flex-1 flex-col items-center justify-center gap-3 bg-background sm:flex">
        <Skeleton className="h-12 w-12 rounded-full" />
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-56" />
      </div>
    </div>
  )
}
