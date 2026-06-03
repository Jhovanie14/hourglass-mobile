import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

function RecentListSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-40" />
      </CardHeader>
      <CardContent className="px-0">
        <ul className="divide-y divide-border">
          {Array.from({ length: 5 }).map((_, i) => (
            <li
              key={i}
              className="flex items-start justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0 space-y-2">
                <Skeleton className="h-4 w-28" />
              </div>
              <Skeleton className="h-3 w-12 shrink-0" />
            </li>
          ))}
        </ul>
      </CardContent>
      <CardFooter>
        <Skeleton className="h-4 w-16" />
      </CardFooter>
    </Card>
  )
}

export default function DashboardLoading() {
  return (
    <div className="space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div className="space-y-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-56" />
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="flex items-start justify-between">
              <div className="space-y-2">
                <Skeleton className="h-8 w-12" />
                <Skeleton className="h-4 w-28" />
              </div>
              <Skeleton className="h-5 w-5 shrink-0 rounded" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Recent conversations + calls */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <RecentListSkeleton />
        <RecentListSkeleton />
      </div>

      {/* Inbox breakdown */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="border-l-4 border-l-muted">
            <CardHeader className="space-y-2">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-3 w-32" />
            </CardHeader>
            <CardContent className="flex gap-6">
              {Array.from({ length: 2 }).map((_, j) => (
                <div key={j} className="space-y-2">
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-7 w-8" />
                </div>
              ))}
            </CardContent>
            <CardFooter>
              <Skeleton className="h-8 w-24 rounded-md" />
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  )
}
