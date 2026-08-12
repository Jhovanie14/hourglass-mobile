# TLP AI Voice Agent → Slack — Design Spec

**Date:** 2026-08-13
**Status:** Draft for 1:1 review (afternoon meeting)
**Author:** Jhovanie + Claude

## Problem

The client wants an AI to answer calls (speak with callers), record the
conversation, and post the transcript to Slack after the call — starting with
the **TLP** brand only, as a test. The client chose **Telnyx AI** as the
engine.

## Goal

When someone calls the TLP number:

1. An AI voice agent answers immediately and holds the conversation.
2. The call audio is recorded.
3. When the call ends, the full transcript (and, once configured, an AI
   summary) is posted to a Slack channel, and the transcript also appears in
   the existing dashboard call history.

Everything is config-gated so it applies **only to TLP** and can be switched
off — or extended to STR / BB / HGI — without code changes.

## Non-goals (v1)

- No transfer-to-human / barge-in (Telnyx supports joining an agent leg into a
  live AI conversation via `joinAIAssistant` — later phase if wanted).
- No dashboard "AI call" badge or in-dashboard recording player for AI calls
  (transcript reuses the existing transcript view; audio is stored + linked in
  Slack). Fast-follow.
- No Slack threading or audio file upload into Slack (needs a Slack bot token;
  v1 uses an incoming webhook).
- No changes to the Chrome extension (server + web only — no Store review).
- No changes to the other three brands or to outbound calls.

## Requirements & setup checklist

What has to exist before this works end-to-end:

**Telnyx portal (one-time, ~15 min)**
1. Create an **AI Assistant** (Mission Control → AI → AI Assistants → Create):
   name (e.g. "TLP Receptionist — Test"), **instructions** (persona/system
   prompt — draft below), **greeting**, **voice** (Telnyx-native voices are
   included in the base price; ElevenLabs needs your own API key), **model**
   (default Telnyx-hosted model is the cheap option; OpenAI/Anthropic models
   cost more per token). Copy the **assistant ID**.
2. *(Recommended)* On the assistant, configure **Insights** with a "summary"
   insight → Telnyx then emits `call.conversation_insights.generated` after
   each call and we post the summary to Slack too.
3. **No number re-pointing.** The TLP number stays on the existing Call
   Control app; we start the assistant on the live call via API.

**Slack (one-time, ~5 min, needs someone who can install Slack apps)**
4. Create a Slack app → enable **Incoming Webhooks** → add a webhook to the
   target channel (e.g. `#tlp-call-log`) → copy the webhook URL.

**Our side (env + SQL + deploy)**
5. Env vars (Vercel + `.env.local`):
   - `TELNYX_AI_ASSISTANT_ID` — assistant ID from step 1 (**feature is fully
     dormant when unset**)
   - `AI_AGENT_LABELS` — comma-separated `phone_numbers.label` values to
     enable, e.g. `TLP`
   - `SLACK_WEBHOOK_URL` — default Slack destination;
     `SLACK_WEBHOOK_URL_<LABEL>` (e.g. `SLACK_WEBHOOK_URL_TLP`) overrides per
     brand
   - `APP_BASE_URL` — optional; adds a dashboard link to Slack messages
6. SQL in the Supabase dashboard (same delivery pattern as `voicemails` /
   `call_transcript_segments`):

   ```sql
   alter table calls add column ai_handled boolean not null default false;
   alter table calls add column ai_conversation_id text;
   alter table calls add column ai_recording_path text;
   ```

   and create a **private** storage bucket `call-recordings`.
7. Web deploy (megestic.com). No extension changes.

**Costs (client-facing)**
- Telnyx Voice AI: **$0.05/min** (orchestration + speech-to-text +
  Telnyx-native text-to-speech), LLM tokens billed separately — with the
  Telnyx-hosted model a production agent runs ≈ **$0.056/min** all-in
  (https://telnyx.com/pricing/voice-ai-agents).
- Normal carrier inbound per-minute charges still apply (as today).
- Recording storage in Supabase: negligible. Slack: free.
- The existing agent-call transcription ($0.025/min) is a separate feature and
  is **not** used for AI calls (see D2).

## Key facts grounding the design (verified in SDK v6.73.0 / code)

- `telnyx.calls.actions.startAIAssistant(callControlId, { assistant: { id },
  … })` starts a portal-configured assistant on a live (answered) Call Control
  call. Emits `call.conversation.ended` and (with insights configured)
  `call.conversation_insights.generated` to the **same voice webhook** we
  already verify and handle.
- `call.conversation.ended` payload carries `conversation_id`,
  `call_control_id`, `duration_sec`, `from`, `to`, `reason` — everything
  needed to correlate back to our `calls` row (`telnyx_call_id`).
- Full conversation history: `telnyx.ai.conversations.messages.list(
  conversation_id)` → `{ role: 'user' | 'assistant' | 'tool', text, sent_at,
  created_at }` (paginated). This **is** the transcript.
- `dynamic_variables` on the start command are usable in the assistant's
  instructions/greeting as `{{name}}`; Telnyx auto-injects `telnyx_call_from`
  etc. We pass `brand_label` so one assistant can serve all four brands later.
- Recording via the existing `startRecording` command works on the same leg;
  `call.recording.saved` is already handled (voicemail flow) and must branch
  for AI calls.
- **The real-time `call.transcription` pipeline is not an option:** since
  2026-07-30 Telnyx accepts our `transcription_start` but has never emitted a
  single `call.transcription` event (open diagnosis, see
  `lib/telnyx/transcription.ts`). The AI conversation history sidesteps that
  entirely and costs nothing extra.

## Approach & decisions

**D1 — When the AI engages: AI answers all TLP inbound calls immediately.**
Matches "AI speaks for callers" and gives the cleanest test signal.
Alternatives (both easy later, same hook point): AI only when no agents are
online (replaces voicemail), or AI after N seconds unanswered. *Meeting
question #3.*

**D2 — Transcript source: Telnyx AI conversation messages, fetched on
`call.conversation.ended`.** Authoritative (it's literally what the LLM
heard/said), attributed per speaker, no extra per-minute cost, and immune to
the broken `call.transcription` events. Rejected: real-time transcription
(broken, +$0.025/min); post-call STT on the recording (extra cost + latency —
kept as documented fallback if messages fetch ever proves unreliable).

**D3 — Storage/UI: reuse `call_transcript_segments`.** Assistant → `agent`,
caller → `contact`; the dashboard transcript view then works for AI calls
unchanged (AI renders as "Agent" — acceptable for v1). The call row finalizes
as `completed` with a duration, so history/stats/Jades stay coherent.

**D4 — Slack delivery: incoming webhook, Block Kit message.** Header
(`🤖 AI call · TLP`), caller, duration, transcript chunked into ≤2,800-char
sections (Slack caps sections at 3,000 chars / 50 blocks per message), long
transcripts truncated with a dashboard pointer. Recording arrives as a second
small message when Telnyx finishes processing it (webhook ordering between
`conversation.ended` and `recording.saved` is not guaranteed; two independent
messages is the robust shape). Rejected for v1: bot token + threads/file
upload (more Slack-side setup; do it when the test graduates).

**D5 — Recording: dual-channel MP3 on the caller leg, stored in the private
`call-recordings` bucket, 7-day signed URL in the Slack message.** Path
`{call_id}.mp3`, remembered in `calls.ai_recording_path` (also the idempotency
guard against Telnyx webhook retries). Falls back to the time-limited Telnyx
URL if the bucket copy fails — same pattern as voicemails.

**D6 — Failure handling: the caller never gets dead air.** If
`startAIAssistant` fails after retries, the call flips to the existing
voicemail flow (`ai_handled` cleared so downstream handlers treat it as a
normal voicemail). Slack/messages-fetch failures are logged and never break
call handling; the transcript still lands in the dashboard when segments were
written, and the conversation ID is logged for manual recovery.

## Components

| Unit | Kind | Responsibility |
|---|---|---|
| `lib/telnyx/ai-agent.ts` (+ test) | pure | env parsing (`aiAgentSettings`, label match), conversation messages → transcript segments (filter `tool`/empty, sort by `sent_at`), Slack-ready transcript lines |
| `lib/slack.ts` (+ test) | pure + one fetch | `slackWebhookForLabel` (per-label env override), Block Kit builders (call message, recording message, summary message; escaping + chunking), `postToSlack` |
| `lib/telnyx/voice-orchestrator.ts` | Telnyx commands | `startAIAssistantOnCall` (assistant id + `dynamic_variables.brand_label`), `startAICallRecording` (dual-channel mp3) — same `withRetry`/`command_id` idiom |
| `lib/telnyx/call-logging.ts` (+ test) | pure | `answeredAction` gains `aiHandled` → new `"start_ai"` action for ringing inbound AI calls |
| `app/api/webhooks/telnyx/voice/route.ts` | webhook | AI branch on `call.initiated` (mark + answer), `"start_ai"` on `call.answered` (start assistant + recording, voicemail fallback), AI branch on `call.recording.saved`, new `call.conversation.ended` and `call.conversation_insights.generated` handlers |
| `types/calls.ts` | types | optional `ai_handled`, `ai_conversation_id`, `ai_recording_path` on `Call` |

## Data & control flow

```
call.initiated (inbound, label ∈ AI_AGENT_LABELS, assistant id set)
  → upsert calls row { status: "ringing", ai_handled: true }
  → answer caller immediately (no agent fan-out, no carrier ringback wait)
call.answered (non-agent, row says ai_handled + ringing → "start_ai")
  → startAIAssistant(A leg, { assistant.id, dynamic_variables: { brand_label } })
  → startRecording(A leg, dual mp3)
  → calls { status: "answered", started_at: now }
  ↳ on start failure: { status: "voicemail", ai_handled: false } + greeting
     (existing voicemail machinery takes over)
…conversation runs; assistant handles speech both ways…
call.hangup → finalizeCall (answered → completed + duration)   [unchanged]
call.conversation.ended (order vs hangup not guaranteed)
  → look up call by call_control_id; skip unless ai_handled;
    skip if ai_conversation_id already set (webhook retry)
  → ai.conversations.messages.list(conversation_id)
  → insert call_transcript_segments (assistant→agent, user→contact)
  → calls { has_transcript, ai_conversation_id }
  → Slack: header + caller + duration + transcript (chunked)
call.conversation_insights.generated (only if insights configured)
  → Slack: "AI summary" message
call.recording.saved (ai_handled row; skip if ai_recording_path set)
  → copy MP3 → call-recordings bucket → calls.ai_recording_path
  → Slack: recording link (7-day signed URL)
```

Voicemail, ring-all, outbound, missed-call notifications, Jades: untouched
code paths (AI calls end `completed`, so no missed-call notification; they
appear to Jades as normal completed inbound calls).

## Error handling & edge cases

- **Assistant start fails** → voicemail fallback (D6); caller hears the
  normal greeting.
- **Caller hangs up mid-greeting** → hangup finalizes row; conversation.ended
  still fires and posts whatever was said.
- **Webhook retries** (Telnyx retries non-2xx/timeout): conversation handler
  guarded by `ai_conversation_id`, recording handler by `ai_recording_path`,
  call upsert by `onConflict: telnyx_call_id` — all idempotent.
- **Messages fetch fails** → log conversation_id loudly + Slack notice with
  metadata and dashboard link ("transcript unavailable"); call row intact.
- **Slack post fails** → logged; transcript is still in the dashboard.
- **`AI_AGENT_LABELS` label typo / unknown label** → no match → normal
  ring-all flow (fail-safe = today's behavior).
- **Kill switch** → unset `TELNYX_AI_ASSISTANT_ID` (or remove the label);
  next call reverts to ring-all. In-flight calls finish their AI flow.

## Testing

- **Unit (vitest, node):** env parsing (unset / one / many labels, case,
  whitespace); message→segment mapping (tool/empty filtering, ordering,
  speaker map); `answeredAction` matrix incl. `aiHandled`; Slack webhook
  per-label fallback; block building (escaping `&<>`, chunk boundaries,
  truncation, ≤50 blocks).
- **Manual E2E (needs real assistant + webhook URL):** call TLP → AI answers;
  hang up → Slack transcript ≤ ~30s later; recording message follows;
  transcript visible in dashboard; call row `completed` with duration; call
  to a non-TLP number → unchanged ring-all; unset assistant id → TLP back to
  ring-all.

## Delivery

Web deploy only (megestic.com). Order: run the SQL + create the bucket →
deploy (feature dormant) → set env vars in Vercel → create assistant + Slack
webhook → set `AI_AGENT_LABELS=TLP` → live test call.

## Open questions for the 1:1

1. **Assistant persona/instructions** — who writes the TLP receptionist
   prompt? (Draft to react to: "You are the friendly receptionist for TLP.
   Answer questions, take messages — collect name, number, and reason for
   calling — and keep replies short and natural. This call may be recorded
   for quality purposes.")
2. **Slack channel** — name, and who has permission to install the webhook
   app in the client's workspace?
3. **Engagement mode** — AI answers *all* TLP calls (built), or only when no
   agent is online / after a ring timeout?
4. **Recording disclosure** — include "this call may be recorded" in the
   greeting? (Recommended; TX is one-party consent, but callers can be
   anywhere.)
5. **Insights** — configure the "summary" insight in the portal so Slack gets
   a TL;DR above the transcript? (Recommended; token cost is pennies.)
6. **Confirm the TLP label string** matches `phone_numbers.label` exactly.
7. **Budget sign-off** — ≈$0.056/min AI cost on top of carrier minutes, only
   on TLP inbound while testing.
8. **Rollout after the test** — other brands = add labels + per-brand Slack
   webhooks + brand-aware instructions via `{{brand_label}}`.
