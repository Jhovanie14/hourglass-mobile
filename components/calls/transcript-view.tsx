"use client"

import { useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/client"
import { Skeleton } from "@/components/ui/skeleton"
import type { TranscriptSegment } from "@/types/calls"

// Consecutive same-speaker segments merged into one block for a chat-style read.
type TranscriptBlock = {
  speaker: TranscriptSegment["speaker"]
  text: string
}

function groupSegments(segments: TranscriptSegment[]): TranscriptBlock[] {
  const blocks: TranscriptBlock[] = []
  for (const seg of segments) {
    const last = blocks[blocks.length - 1]
    if (last && last.speaker === seg.speaker) {
      last.text += ` ${seg.transcript}`
    } else {
      blocks.push({ speaker: seg.speaker, text: seg.transcript })
    }
  }
  return blocks
}

export function TranscriptView({
  callId,
  contactNumber,
}: {
  callId: string
  contactNumber: string
}) {
  const supabase = useMemo(() => createClient(), [])
  const [segments, setSegments] = useState<TranscriptSegment[] | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const { data, error } = await supabase
          .from("call_transcript_segments")
          .select("id, call_id, speaker, transcript, confidence, occurred_at, created_at")
          .eq("call_id", callId)
          .order("occurred_at", { ascending: true })
          .order("created_at", { ascending: true })
        if (error) console.error("Failed to fetch transcript:", error)
        if (!cancelled) setSegments((data ?? []) as TranscriptSegment[])
      } catch (err) {
        console.error("Failed to fetch transcript:", err)
        if (!cancelled) setSegments([])
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [callId, supabase])

  if (segments === null) return <Skeleton className="h-16 w-full max-w-lg" />
  if (segments.length === 0) {
    return <span className="text-xs text-muted-foreground">No transcript available</span>
  }

  const blocks = groupSegments(segments)

  return (
    <div className="max-h-64 space-y-2 overflow-y-auto pr-2">
      {blocks.map((block, i) => (
        <div key={i} className="flex gap-2 text-sm">
          <span className="w-24 shrink-0 text-xs font-medium text-muted-foreground">
            {block.speaker === "agent"
              ? "Agent"
              : block.speaker === "contact"
                ? contactNumber
                : "—"}
          </span>
          <p className="flex-1 text-foreground">{block.text}</p>
        </div>
      ))}
    </div>
  )
}
