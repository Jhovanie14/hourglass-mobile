# TLP AI Receptionist → Live Agent Handoff — Design Spec

**Date:** 2026-08-22
**Status:** Draft for review — **blocked on a spike, see §Unknowns**
**Author:** Jhovanie + Claude
**Supersedes:** `2026-08-18-tlp-ai-transfer-to-agent-design.md` (its D7 snapshot
decision is the thing this spec exists to undo; its built-in-transfer-tool
approach is rejected here, see D-B2)

## Problem

Three facts that only make sense together:

1. **There is no transfer tool on the assistant.** Verified against the live
   assistant on 2026-08-22: `tools` is `[]`. The tool designed in the
   2026-08-18 spec was never added in the Telnyx portal.
2. **The prompt told it to use that tool anyway.** Until today's change, §1 of
   `docs/tlp-ai-assistant-instructions.md` read "If the caller asks to speak to
   a person and agents_available is true, use the transfer tool."
3. **`agents_available` is a snapshot from conversation start**, and since the
   2026-08-19 routing reversal the assistant only picks up on paths where no
   agent was reachable — so it is false by construction in two of three cases.

Together: a caller who asked for a human was told they were being connected,
and then heard silence until they gave up. That is the "don't leave the
customer hanging" complaint.

Today's stopgap (shipped in Track A) is honesty — §1 now says plainly that it
cannot transfer and offers a message instead. This spec restores the
capability properly.

## Goal

A caller talking to the AI asks for a person — in words, or by pressing 1 — and:

1. We check **at that moment** who is online, not who was online when the call
   connected. This is the whole point: agents come back mid-call.
2. If someone is reachable, the caller is told they're being connected, hears
   hold audio rather than dead air, and every online agent rings.
3. If nobody is reachable, the AI says so and takes a message — the behaviour
   it already does well.
4. Any failure in the new path degrades to message-taking. Never to silence.

## Non-goals

- **No warm briefing of the agent.** The built-in transfer tool's
  `warm_transfer_instructions` isn't available to us (D-B2); the agent picks up
  a cold call. The Slack summary lands moments later. Revisit if it bites.
- **No barge-in or three-way.** The AI leaves when the agent arrives.
- No change to the other three brands, to outbound, or to the extension.
- No transfer out of the voicemail fallback path.

## Verified facts (Telnyx SDK 6.73.0, live assistant, 2026-08-22)

- Assistant tool types are `webhook`, `transfer`, `retrieval`, `hangup`,
  `refer`, `handoff`. A `webhook` tool takes `{name, description, url, method,
  body_parameters, headers}`; header values "support mustache templating".
- `TransferTool.targets` is `Array<{to, name}> | string` — a dynamic-variable
  string resolved **at conversation start**, not at transfer time.
- `dynamic_variables_webhook_url` fires **once, at the start of the
  conversation**. This is why the existing `{{ targets }}` snapshot cannot
  satisfy the goal.
- `calls.actions` has `stopAIAssistant`, `playbackStart`, `playbackStop`,
  `bridge`, `speak`, `gather`.
- `telephony_settings.disable_dtmf` is `false` on the live assistant.
- `lib/telnyx/ring-all.ts#getOnlineReachableAgents` already answers "who can
  take a call right now"; `dialAgentLeg` in `voice-orchestrator.ts` already
  rings them all and lets the first answer win.

## Approach & decisions

### D-B1 — One trigger, not two

The obvious reading of "we can use 1" is a DTMF branch in our voice webhook,
parallel to the AI's own conversation. Two triggers means two code paths, two
sets of failure modes, and an ugly collision: when the caller presses 1 and no
agent is available, *something* has to tell them — and our `speak` would talk
over the assistant, which is still on the line.

Instead: **`disable_dtmf` is false, so the assistant receives DTMF as
conversation input.** If that holds (Unknown #2), pressing 1 and saying "put me
through" are the same event as far as the assistant is concerned, and the
instructions handle both:

> If the caller asks for a person, or presses 1, call `connect_to_agent`.

One path. The AI keeps ownership of everything it says, including the
no-agents apology. If Unknown #2 comes back negative we fall back to a DTMF
branch and accept the collision — see Fallback below.

### D-B2 — A webhook tool, not the built-in transfer tool

The built-in `transfer` tool resolves targets from conversation start and picks
exactly one of them. Both properties are disqualifying: we need the check to be
live, and we need ring-all, which is how every other inbound call already
works. A `webhook` tool lets our own endpoint answer the availability question
at the moment it is asked, and run the handoff with machinery we already own
and already test.

Cost: we give up `warm_transfer_instructions` and voicemail detection on the
agent leg. Accepted (see Non-goals).

### D-B3 — The endpoint does the check *and* the handoff

`POST /api/webhooks/telnyx/ai/connect` :

1. Resolve the call (Unknown #1).
2. `getOnlineReachableAgents()` — live.
3. **Nobody:** return `{"connected": false}`. The AI apologises and takes a
   message. Nothing else happens; the conversation continues normally.
4. **Someone:** return `{"connected": true}`, then run the handoff:
   `playbackStart(hold audio, loop)` → `stopAIAssistant` → `dialAgentLeg` to
   every agent → on the agent leg's `call.answered`, `playbackStop` +
   `bridgeLegs`.

Returning before the handoff completes is deliberate: the tool response is what
lets the AI say its line, and the hold audio starts underneath it.

### D-B4 — Hold audio from `public/`

`playbackStart` needs an `audio_url`. A short looping MP3 served from
`${APP_BASE_URL}/hold.mp3` needs no new infrastructure and no Telnyx media
upload. `voice_settings.background_audio` (currently `"silence"`, options
`"silence" | "office"` or a media URL) is a *separate* knob for the whole
conversation — out of scope here, but worth flipping to `"office"` if dead air
between AI turns is also a complaint.

### D-B5 — Nobody answers the handoff

The agents are rung with the same `AI_AGENT_RING_TIMEOUT_SECS` budget. If none
answer: `playbackStop`, then **voicemail**, not the assistant. Restarting the
assistant would drop the caller into a fresh conversation with no memory of
what they'd already said, which is worse than a beep. The caller has by this
point explicitly asked for a human, so a message that reaches one is the right
landing place.

## Unknowns — resolve these before writing the plan

None of these are answerable from the SDK types; each needs a live test call
against the assistant. **This is a spike, and it should be run first.**

1. **Does a webhook tool's request identify the call?** We need the
   `call_control_id` to act. In order of preference: (a) Telnyx includes call
   context in the tool request body; (b) a built-in dynamic variable such as
   `{{telnyx_call_control_id}}` can be templated into a tool header; (c) the
   *dynamic variables* webhook request body carries call identity at
   conversation start, which we echo back as our own dynamic variable and then
   template into the tool header. Note that `app/api/webhooks/telnyx/ai/
   variables/route.ts` currently discards its request body unread — nobody has
   ever looked at what Telnyx sends. Start there; it is one `console.log`.
2. **Does the assistant receive DTMF as conversation input?** If yes, D-B1
   holds and press-1 is free. If no, we need a `call.dtmf.received` branch —
   which also means confirming those events even reach our voice webhook while
   an assistant owns the call.
3. **How long between the tool response and the AI finishing its sentence?**
   `stopAIAssistant` too early clips "connecting you now" mid-word. If the gap
   is unpredictable, the alternative is to stop the assistant immediately and
   `speak` the line ourselves, which is deterministic but costs a beat.

## Error handling

| Failure | Behaviour |
|---|---|
| Tool endpoint 5xx or times out | Telnyx returns the error to the model; instructions say to apologise and take a message |
| Call can't be resolved | `{"connected": false}` — indistinguishable from no-agents to the caller |
| `stopAIAssistant` fails | Abort the handoff, `playbackStop`, let the assistant carry on |
| Every agent dial fails | As D-B5: voicemail |
| Agent answers then drops | Existing hangup handling; unchanged |

## Testing

- Pure units for the availability→response mapping, alongside the existing
  `lib/telnyx/ai-transfer.test.ts`.
- The handoff sequence is orchestration over already-tested primitives; cover
  it with a route test that asserts the call order (`playbackStart` before
  `stopAIAssistant` before `dialAgentLeg`).
- Live: one call where an agent is online, one where none are, one where the
  agent doesn't answer. All three change what the caller hears, so none can be
  signed off from unit tests.

## Setup checklist

1. Spike the three Unknowns (one live call, mostly `console.log`).
2. `public/hold.mp3`.
3. New route `app/api/webhooks/telnyx/ai/connect/route.ts`.
4. Add the `connect_to_agent` webhook tool to the assistant — via
   `scripts/sync-tlp-assistant.mjs`, not the portal, so it stays in the repo.
5. Restore a TRANSFERS paragraph in §1 that describes the tool, replacing the
   "you cannot transfer this call" stopgap.
6. Web deploy. The route is inert until the tool points at it.

**Cost:** unchanged per minute. AI minutes stop when the assistant leaves;
carrier minutes continue.
