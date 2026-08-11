"use client"

import { useEffect, useMemo, useState } from "react"
import { startOfDay, subDays } from "date-fns"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/client"
import { CallsFilterBar, type CallFilters } from "./calls-filter-bar"
import { CallsStats } from "./calls-stats"
import { CallsTable } from "./calls-table"
import { NewCallDialog } from "./new-call-dialog"
import type { Call, CallStats, PhoneNumber } from "@/types/calls"

const PAGE_SIZE = 25

function rangeStart(range: CallFilters["dateRange"]): Date | null {
  const now = new Date()
  switch (range) {
    case "today":
      return startOfDay(now)
    case "yesterday":
      return startOfDay(subDays(now, 1))
    case "7days":
      return startOfDay(subDays(now, 7))
    case "30days":
      return startOfDay(subDays(now, 30))
    case "all":
      return null
  }
}

function rangeEnd(range: CallFilters["dateRange"]): Date | null {
  // Yesterday is the only range with an upper bound (start of today).
  if (range === "yesterday") return startOfDay(new Date())
  return null
}

export function CallsPageClient({
  phoneNumbers,
  initialCalls,
}: {
  phoneNumbers: PhoneNumber[]
  initialCalls: Call[]
}) {
  const supabase = useMemo(() => createClient(), [])
  const [calls, setCalls] = useState<Call[]>(initialCalls)
  const [page, setPage] = useState(1)
  const [filters, setFilters] = useState<CallFilters>({
    inbox: "all",
    status: "all",
    direction: "all",
    dateRange: "7days",
    search: "",
  })

  const phoneById = useMemo(() => {
    const map: Record<string, PhoneNumber> = {}
    for (const p of phoneNumbers) map[p.id] = p
    return map
  }, [phoneNumbers])

  function updateFilters(next: Partial<CallFilters>) {
    setFilters((prev) => ({ ...prev, ...next }))
    setPage(1) // reset pagination on filter change
  }

  // ---- Realtime ----
  useEffect(() => {
    const channel = supabase
      .channel("calls")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "calls" },
        (payload) => {
          const row = payload.new as Call
          const enriched: Call = {
            ...row,
            phone_numbers: phoneById[row.phone_number_id],
          }
          setCalls((prev) =>
            prev.some((c) => c.id === enriched.id)
              ? prev
              : [enriched, ...prev]
          )
          toast(`New call logged from ${enriched.contact_number}`)
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "calls" },
        (payload) => {
          const updated = payload.new as Call
          setCalls((prev) =>
            prev.map((c) =>
              c.id === updated.id
                ? { ...c, ...updated, phone_numbers: c.phone_numbers }
                : c
            )
          )
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, phoneById])

  // ---- Client-side filtering ----
  const filtered = useMemo(() => {
    const start = rangeStart(filters.dateRange)
    const end = rangeEnd(filters.dateRange)
    const q = filters.search.trim().toLowerCase()

    return calls.filter((c) => {
      if (filters.inbox !== "all" && c.phone_number_id !== filters.inbox)
        return false

      if (filters.status !== "all") {
        if (filters.status === "answered") {
          if (c.status !== "answered" && c.status !== "completed") return false
        } else if (c.status !== filters.status) {
          return false
        }
      }

      if (filters.direction !== "all" && c.direction !== filters.direction)
        return false

      const created = new Date(c.created_at)
      if (start && created < start) return false
      if (end && created >= end) return false

      if (q && !c.contact_number.toLowerCase().includes(q)) return false

      return true
    })
  }, [calls, filters])

  // ---- Stats from filtered set ----
  const stats: CallStats = useMemo(() => {
    const answered = filtered.filter(
      (c) => c.status === "answered" || c.status === "completed"
    )
    const missed = filtered.filter((c) => c.status === "missed").length
    const totalDuration = answered.reduce(
      (sum, c) => sum + (c.duration_seconds ?? 0),
      0
    )
    return {
      total: filtered.length,
      answered: answered.length,
      missed,
      avgDurationSeconds:
        answered.length > 0 ? Math.round(totalDuration / answered.length) : 0,
    }
  }, [filtered])

  // ---- Pagination ----
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageStart = (currentPage - 1) * PAGE_SIZE
  const pageCalls = filtered.slice(pageStart, pageStart + PAGE_SIZE)
  const showingFrom = filtered.length === 0 ? 0 : pageStart + 1
  const showingTo = Math.min(pageStart + PAGE_SIZE, filtered.length)

  return (
    <div className="space-y-5 p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Calls
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            View and manage all incoming and outgoing calls across your inboxes
          </p>
        </div>
        <NewCallDialog phoneNumbers={phoneNumbers} />
      </div>

      {/* Sticky filters + stats */}
      <div className="sticky top-0 z-10 space-y-4 bg-background/95 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <CallsFilterBar
          filters={filters}
          onChange={updateFilters}
          phoneNumbers={phoneNumbers}
        />
        <CallsStats stats={stats} />
      </div>

      <CallsTable
        calls={pageCalls}
        statusFilter={filters.status}
        dateFilter={filters.dateRange}
        phoneNumbers={phoneNumbers}
      />

      {/* Pagination */}
      {filtered.length > 0 && (
        <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
          <p className="text-sm text-muted-foreground">
            Showing {showingFrom}–{showingTo} of {filtered.length} calls
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="cursor-pointer"
            >
              Previous
            </Button>
            <span className="px-2 text-sm text-muted-foreground tabular-nums">
              {currentPage} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="cursor-pointer"
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
