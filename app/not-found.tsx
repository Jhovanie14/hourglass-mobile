import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Hourglass, MoveLeft, Home } from "lucide-react"

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 text-center">
      <div className="flex max-w-md flex-col items-center space-y-6">
        {/* Animated Hourglass Icon Container */}
        <div className="relative flex h-24 w-24 items-center justify-center rounded-full bg-muted text-primary/80">
          <Hourglass className="h-12 w-12 animate-[spin_4s_linear_infinite]" />
          <span className="text-foreground absolute -bottom-2 flex h-6 w-12 items-center justify-center rounded-full bg-destructive text-[10px] font-bold tracking-wider uppercase shadow-sm">
            404
          </span>
        </div>

        {/* Text Content */}
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Time Has Run Out
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground sm:text-base">
            The link you followed may be broken, or the communication thread has
            been archived. Let's get you back on track.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
          <Button asChild variant="outline" className="gap-2">
            <Link href="javascript:history.back()">
              <MoveLeft className="h-4 w-4" />
              Go Back
            </Link>
          </Button>

          <Button asChild className="gap-2 shadow-sm">
            <Link href="/dashboard">
              <Home className="h-4 w-4" />
              Back to Dashboard
            </Link>
          </Button>
        </div>
      </div>

      {/* App Branding Footer */}
      <footer className="absolute bottom-6 text-xs font-medium tracking-wider text-muted-foreground/60">
        HOURGLASS MOBILE
      </footer>
    </div>
  )
}
