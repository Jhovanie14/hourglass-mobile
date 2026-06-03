import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

export default function InviteLoading() {
  return (
    <div className="p-4 sm:p-6">
      <div className="mx-auto max-w-md">
        {/* Header */}
        <div className="mb-6 space-y-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-full max-w-sm" />
        </div>

        {/* Form card */}
        <Card className="rounded-2xl border border-border/60 bg-card/60 p-6 shadow-sm backdrop-blur-sm">
          <div className="space-y-4">
            {/* Email field */}
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-10 w-full rounded-lg" />
            </div>
            {/* Role field */}
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-12" />
              <Skeleton className="h-10 w-full rounded-lg" />
            </div>
            {/* Submit button */}
            <Skeleton className="h-10 w-full rounded-lg" />
          </div>
        </Card>
      </div>
    </div>
  )
}
