# Slack setup request — for the client (AI call answering test)

Send the client the message below (edit the channel name if you like). What we
need back from them is **one webhook URL** — nothing else.

Context for us: the URL is a write-only address that lets our server post
messages into exactly one channel of their workspace. It can't read anything.
It should still be treated as a secret (anyone holding it can post into that
channel), so ask them to send it privately; it can be revoked/rotated from the
same Slack page at any time.

---

## Copy-paste message to the client

Subject: 5-minute Slack step to finish the AI call answering test

Hi — the AI receptionist for The Launch Pad is ready on our side. After each
call it posts the conversation transcript, an AI summary, and a link to the
recording into a Slack channel. Since the Slack workspace is yours, this
5-minute step has to happen on your side:

1. **Create the channel** you want the call logs in — our suggestion:
   `#launchpad-calls`. Heads-up: everyone you add to this channel will see
   call transcripts and recording links, so keep it to the right people.
2. Go to **https://api.slack.com/apps** and click **Create New App** → **From
   scratch**. Name it `Launch Pad Call Log` and pick your workspace.
3. In the app's left menu click **Incoming Webhooks**, switch it **On**, then
   click **Add New Webhook to Workspace**. Choose the channel from step 1 and
   click **Allow**.
4. Copy the **Webhook URL** (it starts with
   `https://hooks.slack.com/services/...`) and send it to me in a **private
   message** (please not by group email). Treat it like a password — anyone
   with the link can post into that channel. You can deactivate it anytime
   from the same page.

If Slack tells you app creation needs admin approval, forward this to your
workspace admin — the steps are the same for them.

That's everything. No cost, and nothing else in your Slack changes.

---

## When the URL arrives (our side)

1. Add it to Vercel as `SLACK_WEBHOOK_URL` (Production).
2. Also set `TELNYX_AI_ASSISTANT_ID`, `AI_AGENT_LABELS=TLP`,
   `AI_BRAND_NAMES=TLP:The Launch Pad` (values already in `.env.local`).
3. Deploy, then make a live test call to the TLP number.
