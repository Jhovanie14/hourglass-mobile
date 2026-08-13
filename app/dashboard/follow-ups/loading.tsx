import { Skeleton } from "@/components/ui/skeleton"

export default function FollowUpsLoading() {
  return (
    <div className="space-y-5 p-4 sm:p-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>

      <div className="space-y-6">
        {Array.from({ length: 2 }).map((_, section) => (
          <div key={section}>
            <Skeleton className="mb-2 h-4 w-24" />
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-xl border border-border/60 bg-card p-3"
                >
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-48" />
                  </div>
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-8 w-20" />
                    <Skeleton className="h-8 w-20 rounded-md" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
