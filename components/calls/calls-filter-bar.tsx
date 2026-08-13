"use client"

import { Search } from "lucide-react"
import { cn } from "@/lib/utils"
import type {
  AnsweredByFilter,
  DateRange,
  DirectionFilter,
  PhoneNumber,
  StatusFilter,
} from "@/types/calls"

export type CallFilters = {
  inbox: string
  status: StatusFilter
  direction: DirectionFilter
  answeredBy: AnsweredByFilter
  dateRange: DateRange
  search: string
}

const SELECT_CLASS =
  "cursor-pointer rounded-lg border border-border/60 bg-background/80 px-3 py-2 text-sm text-foreground transition-colors duration-200 focus:border-primary/60 focus:ring-2 focus:ring-primary/40 focus:outline-none"

export function CallsFilterBar({
  filters,
  onChange,
  phoneNumbers,
}: {
  filters: CallFilters
  onChange: (next: Partial<CallFilters>) => void
  phoneNumbers: PhoneNumber[]
}) {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
      {/* Inbox */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="f-inbox" className="text-xs font-medium text-muted-foreground">
          Inbox
        </label>
        <select
          id="f-inbox"
          value={filters.inbox}
          onChange={(e) => onChange({ inbox: e.target.value })}
          className={SELECT_CLASS}
        >
          <option value="all">All Inboxes</option>
          {phoneNumbers.map((pn) => (
            <option key={pn.id} value={pn.id}>
              {pn.label}
            </option>
          ))}
        </select>
      </div>

      {/* Status */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="f-status" className="text-xs font-medium text-muted-foreground">
          Status
        </label>
        <select
          id="f-status"
          value={filters.status}
          onChange={(e) => onChange({ status: e.target.value as StatusFilter })}
          className={SELECT_CLASS}
        >
          <option value="all">All</option>
          <option value="answered">Answered</option>
          <option value="missed">Missed</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      {/* Direction — segmented */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">Direction</span>
        <div className="inline-flex rounded-lg border border-border/60 bg-background/80 p-1">
          {(
            [
              { value: "all", label: "All" },
              { value: "inbound", label: "In" },
              { value: "outbound", label: "Out" },
            ] as { value: DirectionFilter; label: string }[]
          ).map((opt) => {
            const active = filters.direction === opt.value
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onChange({ direction: opt.value })}
                aria-pressed={active}
                className={cn(
                  "cursor-pointer rounded-md px-3 py-1 text-sm font-medium transition-colors duration-200",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Answered by */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="f-answered-by" className="text-xs font-medium text-muted-foreground">
          Answered by
        </label>
        <select
          id="f-answered-by"
          value={filters.answeredBy}
          onChange={(e) => onChange({ answeredBy: e.target.value as AnsweredByFilter })}
          className={SELECT_CLASS}
        >
          <option value="all">All</option>
          <option value="ai">AI assistant</option>
          <option value="team">Team</option>
        </select>
      </div>

      {/* Date range */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="f-date" className="text-xs font-medium text-muted-foreground">
          Date
        </label>
        <select
          id="f-date"
          value={filters.dateRange}
          onChange={(e) => onChange({ dateRange: e.target.value as DateRange })}
          className={SELECT_CLASS}
        >
          <option value="today">Today</option>
          <option value="yesterday">Yesterday</option>
          <option value="7days">Last 7 days</option>
          <option value="30days">Last 30 days</option>
          <option value="all">All time</option>
        </select>
      </div>

      {/* Search */}
      <div className="flex flex-1 flex-col gap-1.5 lg:min-w-48">
        <label htmlFor="f-search" className="text-xs font-medium text-muted-foreground">
          Search
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            id="f-search"
            type="search"
            value={filters.search}
            onChange={(e) => onChange({ search: e.target.value })}
            placeholder="Search by phone number…"
            className="w-full rounded-lg border border-border/60 bg-background/80 py-2 pr-3 pl-9 text-sm text-foreground transition-colors duration-200 placeholder:text-muted-foreground focus:border-primary/60 focus:ring-2 focus:ring-primary/40 focus:outline-none"
          />
        </div>
      </div>
    </div>
  )
}
