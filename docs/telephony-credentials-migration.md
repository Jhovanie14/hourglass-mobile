# Telephony Credentials Migration

## Context

Currently the app uses a single shared Credential Connection login (`usercontact74348`) for all agents — stored in `.env.local` as `TELNYX_SIP_USERNAME` / `TELNYX_SIP_PASSWORD`. This works but means all agents share one identity.

The goal is to give each user their own Telnyx Telephony Credential (`gencred...` login + password) so each agent has an individual SIP identity.

## Telnyx Setup (already done)

- Credential Connection: `hourglass-webrtc`, ID `2975050015291999626`
- Phone number is pointed at this connection
- `timeout_2xx_secs: 30` is set on the connection (gives the voicemail-check cron time to intercept unanswered calls)
- One test credential already exists: `TELNYX_TELEPHONY_CREDENTIAL_ID=972bc459-8afa-4de3-94c1-92570b893e9c`

## What Needs to Change

### 1. Database — add columns to the users/profiles table

```sql
ALTER TABLE profiles
  ADD COLUMN telnyx_sip_username text,
  ADD COLUMN telnyx_sip_password text,
  ADD COLUMN telnyx_credential_id text;
```

> Adjust table name (`profiles` or whatever the app uses) before running.

### 2. Server action — provision credential on user creation

When a new user is created, call the Telnyx API and save the result:

```typescript
const response = await fetch("https://api.telnyx.com/v2/telephony_credentials", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${process.env.TELNYX_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    connection_id: process.env.TELNYX_CREDENTIAL_CONNECTION_ID, // 2975050015291999626
    name: user.email,
  }),
})
const { data } = await response.json()
// data.sip_username → "gencred..."
// data.sip_password → the password
// data.id → credential UUID

await supabase.from("profiles").update({
  telnyx_sip_username: data.sip_username,
  telnyx_sip_password: data.sip_password,
  telnyx_credential_id: data.id,
}).eq("id", user.id)
```

### 3. `/api/calls/webrtc-token/route.ts` — return per-user credentials

Replace the hardcoded env var credentials with a DB lookup:

```typescript
// Current (shared credential):
const login = process.env.TELNYX_SIP_USERNAME
const password = process.env.TELNYX_SIP_PASSWORD

// Replace with:
const { data: { user } } = await supabase.auth.getUser()
const { data: profile } = await supabase
  .from("profiles")
  .select("telnyx_sip_username, telnyx_sip_password")
  .eq("id", user.id)
  .single()

const login = profile.telnyx_sip_username
const password = profile.telnyx_sip_password
```

### 4. Backfill existing users

For any users already in the DB without credentials, run a one-time script that calls `POST /v2/telephony_credentials` for each and saves the result.

## Env Vars

After migration, `TELNYX_SIP_USERNAME` and `TELNYX_SIP_PASSWORD` in `.env.local` are no longer needed (credentials come from the DB). Keep `TELNYX_CREDENTIAL_CONNECTION_ID` — it's used when provisioning new credentials.

## Files to Edit

| File | Change |
|------|--------|
| `supabase/migrations/` | Add `telnyx_sip_username`, `telnyx_sip_password`, `telnyx_credential_id` columns |
| `app/api/calls/webrtc-token/route.ts` | Return per-user credentials from DB |
| User creation flow (wherever new users are created) | Call Telnyx API + save credentials |

## Paste Prompt for New Session

> "I want to implement per-user Telephony Credentials for the Telnyx WebRTC setup in this Next.js app. Read `docs/telephony-credentials-migration.md` for the full context and plan, then implement it. Ask me for the profiles table name before starting."
