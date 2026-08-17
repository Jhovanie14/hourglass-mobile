# TLP AI Voice Agent → Transfer to Human Agent — Design Spec

**Date:** 2026-08-18
**Status:** Draft for review
**Author:** Jhovanie + Claude
**Parent spec:** `2026-08-13-tlp-ai-voice-slack-design.md` (this amends its
`Non-goals` line 29 and builds on decision D1 / open question #3)

## Problem

Open question #3 was settled on 2026-08-13: **the AI answers every TLP inbound
call, even when agents are online.** The consequence is that a caller who wants
a human has no route to one. The assistant has no transfer capability, so when
someone says "put me through to a person" it simply keeps talking.

The parent spec listed transfer-to-human as an explicit v1 non-goal. This spec
brings it into scope as the caller's escape hatch, which is what makes
"AI answers everything" safe to keep.

## Goal

1. A caller asks for a human in their own words ("transfer me", "can I speak to
   someone", "is there a person there").
2. If any agent is online, the call is transferred to one, and the AI briefs
   that agent before they take over.
3. If no agent is online, the AI says nobody is available right now and offers
   to take a message — which it already does well.
4. Config-gated and dormant until enabled in the Telnyx portal. Any failure in
   the new path degrades to message-taking, never to dead air.

## Non-goals (v1)

- **No ring-all on transfer.** Telnyx's built-in transfer tool picks *one*
  target. The existing inbound flow rings every online agent and lets the first
  answer win; transfers will not. See D8 and Known limitations.
- **No live availability re-check at the moment of transfer.** Availability is
  a snapshot taken at conversation start. See D7.
- **No barge-in or three-way.** The AI hands the call over and leaves; it does
  not stay on the line. (`joinAIAssistant` remains the later-phase option.)
- **No agent attribution for transferred calls** in the new answered-by filter.
  See Known limitations.
- No transfer out of the voicemail fallback path (if `startAIAssistant` failed,
  the call is already a normal voicemail).
- No changes to the other three brands, to outbound calls, or to the Chrome
  extension.

## Requirements & setup checklist

**Telnyx portal (one-time, on the existing TLP assistant)**

1. Add a **transfer** tool to the assistant:
   - `from` — the TLP DID (the number placing the transfer leg).
   - `targets` — the literal string `{{ targets }}` so it resolves from the
     dynamic variables webhook at runtime.
   - `warm_transfer_instructions` — natural-language briefing (D10).
   - `voicemail_detection` — see open question #6.
2. Set **`dynamic_variables_webhook_url`** to
   `https://www.megestic.com/api/webhooks/telnyx/ai/variables`.
3. Set **`dynamic_variables_webhook_timeout_ms`** (1–10000). Recommend 3000.
4. Set assistant **default** `dynamic_variables` to the fail-safe values
   (D9): `agents_available: false`, `targets: []`.
5. Update assistant **instructions** to cover both branches (D11).

**Our side**

6. One new route: `app/api/webhooks/telnyx/ai/variables/route.ts`.
7. No new SQL. No new env vars — brand naming reuses `AI_BRAND_NAMES`,
   availability reuses the existing presence tables, and the target cap is a
   module constant in `lib/telnyx/ai-transfer.ts` (not configurable; see open
   question #5 for its value).
8. Web deploy (megestic.com). The route is inert until the portal points at it.

**Cost:** no change to the per-minute rate. A transferred call continues to
bill carrier minutes; AI minutes stop when the assistant leaves.

## Key facts grounding the design (verified in SDK v6.73.0)

- Assistant tools include a first-class transfer type:
  `{ type: "transfer", transfer: { from, targets, custom_headers?,
  voicemail_detection?, warm_message_delay_ms?, warm_transfer_instructions? } }`.
  We do not hand-build the transfer.
- `targets: Array<{ to: string; name?: string }> | string`. The string form is
  documented as "a dynamic variable string like `{{ targets }}` where `targets`
  is returned by the dynamic variables webhook and resolves to an array of
  target objects at runtime."
- `dynamic_variables_webhook_url`: "Telnyx sends a POST request to this URL **at
  the start of the conversation** to resolve dynamic variables." It fires once
  per conversation, **not** at transfer time — this is the source of the
  snapshot limitation in D7.
- **Documented gotcha:** the response "must wrap variables under a top-level
  `dynamic_variables` object… Returning a flat object will be ignored and
  variables will fall back to their defaults."
- `dynamic_variables_webhook_timeout_ms` is 1–10000 ms, and "if the webhook does
  not respond within this timeout, the call proceeds with default values" —
  which is what makes D9 a genuine safety net rather than decoration.
- `TargetsList` carries only `to` and `name`. `custom_headers` sits on the
  transfer object, not per target, so a header cannot identify *which* target
  was chosen.
- `getOnlineReachableAgents(admin, now)` in `lib/telnyx/ring-all.ts` already
  answers "who can take a call", unioning presence-online agents with agents
  that have an available device. It returns `ReachableAgent[]` carrying
  `sipUsername` and `userId`.
- The agent SIP URI form is `sip:{sipUsername}@sip.telnyx.com`, as used by
  `dialAgentLeg` in `lib/telnyx/voice-orchestrator.ts`.

## Approach & decisions

**D7 — Availability is resolved by the dynamic variables webhook at
conversation start.** Telnyx POSTs our route when the AI conversation begins;
we call `getOnlineReachableAgents()` and return both a boolean the instructions
can branch on and the target list the transfer tool will use.

The honest cost of this is staleness: the answer reflects who was online when
the call connected. If the only online agent goes offline during a long call,
the AI still believes transfer is possible and will attempt a target that no
longer answers. Rejected alternative: a custom webhook tool the assistant calls
*at* transfer time, which would be live but means hand-building the dial and
`joinAIAssistant` and giving up the built-in tool. For a team this size the
window is short and the failure is recoverable (see Error handling), so v1
takes the snapshot. Revisit if it bites in practice.

**D8 — Use the built-in transfer tool with a single target.** The tool does
target selection, the dial, the warm handoff and voicemail detection for us. The
trade is that it picks one target rather than ringing all online agents. Given
the client's own framing ("transfer the call to them"), one agent is the
expected behaviour; ring-all is an optimisation, not a requirement. Rejected:
custom webhook tool + `dialAgentLeg` + `joinAIAssistant`, which buys ring-all
and live availability at a much larger surface — held as the phase-2 option if
either limitation proves real.

**D9 — Fail safe by default.** The assistant's default dynamic variables are
`agents_available: false` and `targets: []`. Every failure mode in the new path
— route down, deploy in progress, slow query, signature rejection, malformed
response — lands on those defaults, and the AI takes a message exactly as it
does today. A broken transfer feature is therefore indistinguishable from the
current, working behaviour. This is the single most important property of the
design.

**D10 — Warm transfer, not blind.** `warm_transfer_instructions` tells the
assistant to summarise before handing over, so the agent hears who is calling
and why instead of picking up cold. Draft: *"Before connecting, briefly tell the
person who answers the caller's name, their number, and the reason they called.
Keep it to one or two sentences."*

**D11 — The assistant branches on `agents_available` in its instructions.**
Draft addition to the TLP prompt:

> If the caller asks to speak to a person and `agents_available` is true, use
> the transfer tool. If `agents_available` is false, tell them no one is
> available right now, offer to take a message, and collect their name, number
> and reason for calling. Do not promise a transfer you cannot make, and do not
> offer a transfer unless they ask for one.

**D12 — A transferred call still produces a transcript and a Slack post.**
When the assistant leaves, `call.conversation.ended` fires and the existing
handler writes `call_transcript_segments` and posts to Slack — capturing the AI
portion of the conversation. The human portion is not transcribed (the AI is
gone, and real-time transcription remains broken per the parent spec). The Slack
message should say the call was transferred so the transcript's abrupt ending is
not read as a bug.

**D13 — No change to call-row lifecycle, ordering or idempotency.** The caller
leg is still the row we track, `call.hangup` still finalizes it as `completed`
with a duration, and the existing `ai_conversation_id` / `ai_recording_path`
guards still make the conversation and recording handlers idempotent.

## Components

| Unit | Kind | Responsibility |
|---|---|---|
| `lib/telnyx/ai-transfer.ts` (+ test) | pure | `transferVariables(agents, label, env)` → the `dynamic_variables` payload: `agents_available` boolean, `targets` array of `{ to, name }` built from `sipUsername`, brand name via existing `brandNameForLabel`, plus the target cap |
| `app/api/webhooks/telnyx/ai/variables/route.ts` | webhook | verify the Telnyx signature, resolve the brand from the payload's `to` number, call `getOnlineReachableAgents`, respond `{ dynamic_variables: … }`; always 200 with fail-safe values rather than an error status |
| Telnyx portal assistant | config | transfer tool, webhook URL + timeout, default variables, instructions |

Nothing in `lib/telnyx/ai-agent.ts`, the voice webhook, the Slack builders or
the call-logging matrix needs to change, apart from the transferred-call note in
the Slack message (D12).

## Data & control flow

```
call.initiated (inbound, TLP)  → answer → startAIAssistant     [unchanged]

Telnyx POST /api/webhooks/telnyx/ai/variables   (once, at conversation start)
  → verify Ed25519 signature
  → resolve phone_numbers.label from payload `to`
  → getOnlineReachableAgents(admin)
  → 200 { dynamic_variables: {
             brand_name:       "The Launch Pad",
             agents_available: true,
             targets: [{ to: "sip:gencredXYZ@sip.telnyx.com", name: "Agent" }]
        }}
  ↳ non-2xx, malformed, or slower than the timeout
      → assistant defaults: agents_available false, targets []

…conversation runs…

caller: "can you transfer me to a person?"
  ├─ agents_available true
  │    → assistant invokes the transfer tool
  │    → Telnyx dials one target, from = TLP DID
  │    → warm_transfer_instructions briefing on answer
  │    → caller bridged to the agent; assistant leaves
  │    ↳ no answer / voicemail detected → voicemail_detection action
  └─ agents_available false
       → "No one is available right now, can I take a message?"   [existing]

call.conversation.ended → messages → segments + Slack (+ transferred note)
call.hangup             → finalizeCall (completed + duration)     [unchanged]
```

## Error handling & edge cases

- **Route down, slow, or mid-deploy** → assistant defaults → AI takes a
  message. Indistinguishable from today's behaviour (D9).
- **Response not wrapped in `dynamic_variables`** → Telnyx silently ignores it
  and uses defaults. A unit test asserts the wrapper shape, because this
  failure is invisible at runtime.
- **Signature verification fails** → log loudly, return the fail-safe payload
  with 200. Returning 403 would also fall back to defaults, but a 200 keeps
  Telnyx from retrying a request we will never accept.
- **Agent goes offline mid-call** → stale target; the transfer attempt does not
  answer. `voicemail_detection` / no-answer handling ends the attempt and the
  caller is not stranded, but they will hear a failed attempt first. Accepted
  in v1 (D7).
- **Agent comes online mid-call** → not offered a transfer. Accepted.
- **No agents at conversation start** → `agents_available` false; the AI never
  offers a transfer it cannot fulfil.
- **Caller asks repeatedly after being told nobody is available** → the
  instructions must not loop; the assistant should take the message and move on.
- **Caller asks to be transferred on a non-TLP number** → those numbers never
  reach the assistant; unchanged ring-all applies.
- **Kill switch** → remove the transfer tool (or the webhook URL) in the portal.
  Next call reverts to AI-with-message-taking. Unsetting
  `TELNYX_AI_ASSISTANT_ID` still reverts TLP to ring-all entirely.

## Known limitations

**Transferred calls will not attribute to an agent.** `TargetsList` exposes only
`to` and `name`, and `custom_headers` are transfer-level rather than per-target,
so nothing tells us which target Telnyx actually connected. The recently added
answered-by filter will therefore show no agent for a transferred call. Closing
this means either correlating the answered leg from a later webhook, or moving
to the custom webhook-tool route (which would also give ring-all and live
availability). Flagged as open question #7 rather than silently shipped.

## Testing

**Unit (vitest, node)** — `lib/telnyx/ai-transfer.test.ts`:
- zero agents → `agents_available: false`, `targets: []`
- one agent → one target, SIP URI form `sip:{sipUsername}@sip.telnyx.com`
- many agents → capped, order stable
- payload is wrapped under a top-level `dynamic_variables` key
- brand name resolves through `AI_BRAND_NAMES`, falls back to the raw label

**Manual E2E** (needs the portal tool configured):
1. Agent online → call TLP → ask for a person → transfer connects, agent hears
   the briefing, conversation continues with the human.
2. All agents offline → same request → AI says nobody is available and takes a
   message.
3. Point the webhook URL at a nonexistent path → AI falls back to
   message-taking (proves D9).
4. After a successful transfer → Slack still receives the AI-portion transcript
   and the dashboard shows the segments.
5. Non-TLP number → unchanged ring-all.

## Delivery

Web deploy only. Order: deploy the route (inert) → add the transfer tool,
webhook URL, timeout, defaults and instructions in the Telnyx portal → live
test call with an agent online, then with all agents offline.

## Open questions

1. **Webhook authentication** — confirm the dynamic variables webhook is signed
   with the same Ed25519 scheme as the voice/message webhooks. If it is not,
   decide the alternative (shared secret in the path, or a header check).
   *Blocking for the route's auth.*
2. **Transfer script wording** — sign off on the D10 briefing and the D11
   no-agents line.
3. **Proactive vs on-request** — should the AI ever offer a transfer unprompted,
   or only when asked? *Recommend on-request only.*
4. **Business hours** — should `agents_available` also respect opening hours, or
   purely live presence? *Recommend presence only for v1.*
5. **Target cap** — how many agents to pass. *Recommend 5.*
6. **Voicemail detection action** — `stop_transfer` (hang up the attempt) or
   `leave_message_and_stop_transfer`? *Recommend `stop_transfer` so the caller
   returns to the AI rather than hearing a message left on their behalf.*
7. **Answered-by attribution** — accept the gap in v1, or pull the custom
   webhook-tool route forward to close it (and gain ring-all)?
