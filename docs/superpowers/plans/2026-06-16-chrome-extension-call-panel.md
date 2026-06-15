# Chrome Extension Call Panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a secure Manifest V3 Chrome extension that gives Hourglass agents an always-available side-panel call panel (see incoming calls, dial out, pick which of the 5 numbers is the caller ID), reusing the existing Telnyx WebRTC call logic.

**Architecture:** The extension is a thin shell whose side panel iframes a new slim `/panel` route of the deployed Next.js app at `https://www.megestic.com`. All telephony and credentials stay on that origin. The panel authenticates **client-side** via Supabase (token-based, not cookies — cookies don't survive a cross-site extension iframe) and sends the access token as a Bearer header to API routes. The extension ships zero secrets.

**Tech Stack:** Next.js 16 (App Router), React 19, Supabase JS (`@supabase/ssr`, `@supabase/supabase-js`), Telnyx WebRTC, Chrome Extensions MV3 (`sidePanel`, `notifications`).

**Reference spec:** `docs/superpowers/specs/2026-06-16-chrome-extension-call-panel-design.md`

---

## Testing note

This repo has **no unit-test runner** (no jest/vitest in `package.json`). Per the
"follow existing patterns" rule, verification in this plan uses the tools the repo
already has — `npm run lint`, `npm run typecheck`, `npm run build` — plus
`curl`-based security checks and a manual end-to-end checklist. Do **not** add a
test framework for this work.

## File Structure

**Modify (Next.js app):**
- `app/api/calls/webrtc-token/route.ts` — accept cookie **or** Bearer token; 401 otherwise.
- `components/calls/hooks/use-webrtc-client.ts` — attach Supabase access token to the token fetch.
- `components/calls/webrtc-provider.tsx` — when running inside an iframe, `postMessage` incoming/active/ended events to the parent.
- `next.config.ts` — add `frame-ancestors` CSP header on `/panel`.
- `.gitignore` — ignore the extension signing key.

**Create (Next.js app):**
- `app/panel/page.tsx` — the panel route (renders the client app).
- `components/calls/panel/panel-app.tsx` — auth gate + data load + provider wrapper.
- `components/calls/panel/panel-login.tsx` — email/password login form.
- `components/calls/panel/panel-dialer.tsx` — From-number selector + To input + Call button.

**Create (extension):**
- `extension/manifest.json`
- `extension/side-panel.html`
- `extension/panel.js`
- `extension/service-worker.js`
- `extension/icon16.png`, `extension/icon48.png`, `extension/icon128.png`
- `scripts/make-icon.mjs` — pure-Node PNG generator for the icons.

---

## Task 1: Token-or-cookie auth on the WebRTC token endpoint

**Files:**
- Modify: `app/api/calls/webrtc-token/route.ts`

> Note: a cookie-only auth gate was already added earlier in this branch. This task replaces it with one that **also** accepts a Bearer token (the panel uses Bearer; the web app uses cookies).

- [ ] **Step 1: Replace the route with cookie-or-Bearer authorization**

```ts
import { getCurrentUser } from "@/lib/auth"
import { createClient as createSupabaseClient } from "@supabase/supabase-js"

export const runtime = "nodejs"

async function isAuthorized(req: Request): Promise<boolean> {
  // 1. Cookie-based session (the web app)
  const user = await getCurrentUser()
  if (user) return true

  // 2. Bearer access token (the extension panel)
  const authHeader = req.headers.get("authorization") ?? ""
  const token = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : null
  if (!token) return false

  const supabase = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  )
  const { data, error } = await supabase.auth.getUser(token)
  return !error && !!data.user
}

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const login = process.env.TELNYX_SIP_USERNAME
  const password = process.env.TELNYX_SIP_PASSWORD

  if (!login || !password) {
    return Response.json(
      { error: "TELNYX_SIP_USERNAME or TELNYX_SIP_PASSWORD not set" },
      { status: 500 }
    )
  }

  return Response.json({ login, password })
}
```

- [ ] **Step 2: Lint the file**

Run: `npx eslint app/api/calls/webrtc-token/route.ts`
Expected: no errors.

- [ ] **Step 3: Verify unauthenticated requests are rejected**

Run (with `npm run dev` running in another terminal):
`curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/calls/webrtc-token`
Expected: `401`

- [ ] **Step 4: Commit**

```bash
git add app/api/calls/webrtc-token/route.ts
git commit -m "feat: accept Bearer token or cookie on webrtc-token endpoint"
```

---

## Task 2: Send the Supabase access token with the WebRTC token fetch

**Files:**
- Modify: `components/calls/hooks/use-webrtc-client.ts:26-35`

The web app's session is readable client-side via the browser Supabase client
(cookies), and the panel's session is readable the same way (localStorage). So a
single code path works for both: read the session, attach a Bearer header if present.

- [ ] **Step 1: Add the import at the top of the file**

Add after the existing imports (below line 6):

```ts
import { createClient } from "@/lib/client"
```

- [ ] **Step 2: Attach the token to the fetch**

Replace these lines (currently lines 29-30):

```ts
      const res = await fetch("/api/calls/webrtc-token")
      if (!res.ok) {
```

with:

```ts
      const supabase = createClient()
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const res = await fetch("/api/calls/webrtc-token", {
        headers: session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : {},
      })
      if (!res.ok) {
```

- [ ] **Step 3: Typecheck and lint**

Run: `npx eslint components/calls/hooks/use-webrtc-client.ts`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/calls/hooks/use-webrtc-client.ts
git commit -m "feat: send Supabase access token with webrtc-token fetch"
```

---

## Task 3: Emit call events to the extension shell when iframed

**Files:**
- Modify: `components/calls/webrtc-provider.tsx`

When the provider runs inside the side-panel iframe (`window.parent !== window`),
post minimal events to the parent so the extension can raise notifications and a
badge. The message shape is the stable contract reused by a future Phase 2.

- [ ] **Step 1: Add `useEffect` to the React import**

Change line 5-10 import block so it includes `useEffect`:

```ts
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react"
```

- [ ] **Step 2: Add the postMessage effects just before the `return`**

Find the `callerNumber` / `activeNumber` `const` declarations near the end of the
component (currently lines 247-255). Immediately **after** them and **before**
`return (`, insert:

```ts
  // Bridge call events to the extension shell when embedded in the side panel.
  const embedded =
    typeof window !== "undefined" && window.parent !== window

  useEffect(() => {
    if (!embedded) return
    if (incomingCall && !activeCall) {
      window.parent.postMessage(
        {
          source: "hourglass-panel",
          type: "incoming",
          caller: callerNumber,
          label: inboundPhoneNumber?.label ?? null,
        },
        "*"
      )
    }
  }, [embedded, incomingCall, activeCall, callerNumber, inboundPhoneNumber])

  useEffect(() => {
    if (!embedded) return
    window.parent.postMessage(
      { source: "hourglass-panel", type: activeCall ? "call-active" : "call-ended" },
      "*"
    )
  }, [embedded, activeCall])
```

- [ ] **Step 3: Typecheck and lint**

Run: `npx eslint components/calls/webrtc-provider.tsx`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/calls/webrtc-provider.tsx
git commit -m "feat: post call events to parent frame when embedded in side panel"
```

---

## Task 4: The `/panel` route, auth gate, and login form

**Files:**
- Create: `app/panel/page.tsx`
- Create: `components/calls/panel/panel-app.tsx`
- Create: `components/calls/panel/panel-login.tsx`

- [ ] **Step 1: Create the route**

`app/panel/page.tsx`:

```tsx
import { PanelApp } from "@/components/calls/panel/panel-app"

export const dynamic = "force-dynamic"

export default function PanelPage() {
  return <PanelApp />
}
```

- [ ] **Step 2: Create the login form**

`components/calls/panel/panel-login.tsx`:

```tsx
"use client"

import { useState } from "react"
import type { SupabaseClient } from "@supabase/supabase-js"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export function PanelLogin({ supabase }: { supabase: SupabaseClient }) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
    setBusy(false)
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 p-4">
      <h1 className="text-base font-semibold text-foreground">
        Hourglass Call Panel
      </h1>
      <Input
        type="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoComplete="username"
        required
      />
      <Input
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="current-password"
        required
      />
      {error && <p className="text-sm text-red-500">{error}</p>}
      <Button type="submit" disabled={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  )
}
```

- [ ] **Step 3: Create the auth gate / app shell**

`components/calls/panel/panel-app.tsx`:

```tsx
"use client"

import { useEffect, useState } from "react"
import type { Session } from "@supabase/supabase-js"
import { createClient } from "@/lib/client"
import { WebRTCProvider } from "@/components/calls/webrtc-provider"
import type { PhoneNumber } from "@/types/calls"
import { PanelLogin } from "./panel-login"
import { PanelDialer } from "./panel-dialer"

export function PanelApp() {
  const [supabase] = useState(() => createClient())
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [phoneNumbers, setPhoneNumbers] = useState<PhoneNumber[]>([])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) =>
      setSession(s)
    )
    return () => sub.subscription.unsubscribe()
  }, [supabase])

  useEffect(() => {
    if (!session) return
    supabase
      .from("phone_numbers")
      .select("id, label, phone_number, color")
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .then(({ data }) => setPhoneNumbers((data ?? []) as PhoneNumber[]))
  }, [session, supabase])

  if (loading) {
    return <div className="p-4 text-sm text-muted-foreground">Loading…</div>
  }

  if (!session) {
    return <PanelLogin supabase={supabase} />
  }

  return (
    <WebRTCProvider>
      <PanelDialer
        phoneNumbers={phoneNumbers}
        onSignOut={() => supabase.auth.signOut()}
      />
    </WebRTCProvider>
  )
}
```

- [ ] **Step 4: Lint (PanelDialer import will error until Task 5 — that is expected)**

Run: `npx eslint components/calls/panel/panel-app.tsx components/calls/panel/panel-login.tsx app/panel/page.tsx`
Expected: the only error is the unresolved `./panel-dialer` import, fixed in Task 5. Login form and page lint clean.

- [ ] **Step 5: Commit**

```bash
git add app/panel/page.tsx components/calls/panel/panel-app.tsx components/calls/panel/panel-login.tsx
git commit -m "feat: add /panel route with client-side auth gate and login"
```

---

## Task 5: The panel dialer

**Files:**
- Create: `components/calls/panel/panel-dialer.tsx`

A slim, always-visible version of `NewCallDialog`'s form (From selector + To input
+ Call button). Incoming-call popup and active-call HUD come for free from
`WebRTCProvider`.

- [ ] **Step 1: Create the dialer**

`components/calls/panel/panel-dialer.tsx`:

```tsx
"use client"

import { useState } from "react"
import { LogOut, Phone } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useWebRTC } from "@/components/calls/webrtc-provider"
import type { PhoneNumber } from "@/types/calls"

export function PanelDialer({
  phoneNumbers,
  onSignOut,
}: {
  phoneNumbers: PhoneNumber[]
  onSignOut: () => void
}) {
  const { isReady, makeCall } = useWebRTC()
  const [to, setTo] = useState("")
  const [phoneNumberId, setPhoneNumberId] = useState("")

  const selectedId = phoneNumberId || phoneNumbers[0]?.id || ""
  const selectedPhone = phoneNumbers.find((p) => p.id === selectedId)

  function handleCall() {
    if (!to.trim() || !selectedPhone) return
    makeCall(to.trim(), selectedPhone)
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-base font-semibold text-foreground">Call Panel</h1>
        <button
          type="button"
          onClick={onSignOut}
          aria-label="Sign out"
          className="text-muted-foreground transition hover:text-foreground"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="panel-from" className="text-sm font-medium">
          From
        </label>
        <select
          id="panel-from"
          value={selectedId}
          onChange={(e) => setPhoneNumberId(e.target.value)}
          className="border-input bg-background text-foreground flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs focus:outline-none focus:ring-1 focus:ring-ring"
        >
          {phoneNumbers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label} · {p.phone_number}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="panel-to" className="text-sm font-medium">
          To
        </label>
        <Input
          id="panel-to"
          placeholder="+1 (555) 000-0000"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCall()}
        />
      </div>

      <Button
        className="w-full gap-1.5"
        onClick={handleCall}
        disabled={!isReady || !to.trim() || !selectedPhone}
      >
        <Phone className="h-4 w-4" />
        {!isReady ? "Connecting…" : "Call"}
      </Button>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck the panel module set**

Run: `npx eslint components/calls/panel/`
Expected: no errors (the Task 4 import now resolves).

- [ ] **Step 3: Build to confirm the route compiles**

Run: `rm -rf .next && npm run build`
Expected: build succeeds and lists `/panel` in the route output.
(`rm -rf .next` clears stale generated route types from deleted routes.)

- [ ] **Step 4: Commit**

```bash
git add components/calls/panel/panel-dialer.tsx
git commit -m "feat: add panel dialer with number selector and caller-ID picker"
```

---

## Task 6: Frame-ancestors CSP on `/panel`

**Files:**
- Modify: `next.config.ts`

Restrict who may iframe `/panel` to this extension only. Uses a placeholder ID
filled in by Task 8.

- [ ] **Step 1: Replace `next.config.ts`**

```ts
import type { NextConfig } from "next"

// Replaced with the real, pinned extension id in Task 8.
const EXTENSION_ID = "__EXTENSION_ID__"

const nextConfig: NextConfig = {
  serverExternalPackages: ["ws", "telnyx"],
  async headers() {
    return [
      {
        source: "/panel",
        headers: [
          {
            key: "Content-Security-Policy",
            value: `frame-ancestors chrome-extension://${EXTENSION_ID}`,
          },
        ],
      },
    ]
  },
}

export default nextConfig
```

- [ ] **Step 2: Build to confirm config is valid**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add next.config.ts
git commit -m "feat: restrict /panel framing to the extension via CSP frame-ancestors"
```

---

## Task 7: Extension scaffold

**Files:**
- Create: `scripts/make-icon.mjs`
- Create: `extension/icon16.png`, `extension/icon48.png`, `extension/icon128.png`
- Create: `extension/manifest.json`
- Create: `extension/side-panel.html`
- Create: `extension/panel.js`
- Create: `extension/service-worker.js`

- [ ] **Step 1: Create the icon generator (pure Node, no deps)**

`scripts/make-icon.mjs`:

```js
import { deflateSync } from "node:zlib"
import { mkdirSync, writeFileSync } from "node:fs"

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return (~c) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, "ascii")
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([len, typeBuf, data, crc])
}

function makePng(size, [r, g, b]) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type: RGB
  const row = Buffer.alloc(1 + size * 3) // 1 filter byte + RGB pixels
  for (let x = 0; x < size; x++) {
    row[1 + x * 3] = r
    row[2 + x * 3] = g
    row[3 + x * 3] = b
  }
  const raw = Buffer.concat(Array.from({ length: size }, () => row))
  const idat = deflateSync(raw)
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ])
}

mkdirSync(new URL("../extension/", import.meta.url), { recursive: true })
const color = [99, 102, 241] // indigo
for (const s of [16, 48, 128]) {
  writeFileSync(
    new URL(`../extension/icon${s}.png`, import.meta.url),
    makePng(s, color)
  )
}
console.log("icons written")
```

- [ ] **Step 2: Generate the icons**

Run: `node scripts/make-icon.mjs`
Expected: prints `icons written`; `extension/icon16.png`, `icon48.png`, `icon128.png` exist.

Verify they are valid PNGs:
Run: `file extension/icon128.png`
Expected: `PNG image data, 128 x 128`

- [ ] **Step 3: Create the manifest (placeholders filled in Task 8)**

`extension/manifest.json`:

```json
{
  "manifest_version": 3,
  "name": "Hourglass Call Panel",
  "version": "1.0.0",
  "description": "Always-available call panel for Hourglass agents.",
  "minimum_chrome_version": "114",
  "key": "__MANIFEST_KEY__",
  "permissions": ["sidePanel", "notifications"],
  "host_permissions": ["https://www.megestic.com/*"],
  "background": { "service_worker": "service-worker.js" },
  "side_panel": { "default_path": "side-panel.html" },
  "action": {
    "default_title": "Open Hourglass Call Panel",
    "default_icon": {
      "16": "icon16.png",
      "48": "icon48.png",
      "128": "icon128.png"
    }
  },
  "icons": {
    "16": "icon16.png",
    "48": "icon48.png",
    "128": "icon128.png"
  }
}
```

- [ ] **Step 4: Create the side panel page**

`extension/side-panel.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html,
      body {
        margin: 0;
        height: 100%;
      }
      iframe {
        display: block;
        width: 100%;
        height: 100vh;
        border: 0;
      }
    </style>
  </head>
  <body>
    <iframe
      src="https://www.megestic.com/panel"
      allow="microphone; autoplay"
    ></iframe>
    <script src="panel.js"></script>
  </body>
</html>
```

- [ ] **Step 5: Create the message bridge**

`extension/panel.js`:

```js
const PANEL_ORIGIN = "https://www.megestic.com"

function setActiveBadge() {
  chrome.action.setBadgeText({ text: "●" })
  chrome.action.setBadgeBackgroundColor({ color: "#22c55e" })
}

window.addEventListener("message", (event) => {
  if (event.origin !== PANEL_ORIGIN) return
  const msg = event.data
  if (!msg || msg.source !== "hourglass-panel") return

  if (msg.type === "incoming") {
    chrome.notifications.create("hourglass-incoming", {
      type: "basic",
      iconUrl: "icon128.png",
      title: "Incoming call",
      message: msg.label ? `${msg.caller} → ${msg.label}` : String(msg.caller),
      priority: 2,
    })
    setActiveBadge()
  } else if (msg.type === "call-active") {
    setActiveBadge()
  } else if (msg.type === "call-ended") {
    chrome.action.setBadgeText({ text: "" })
    chrome.notifications.clear("hourglass-incoming")
  }
})
```

- [ ] **Step 6: Create the service worker**

`extension/service-worker.js`:

```js
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => {})
})

chrome.notifications.onClicked.addListener((id) => {
  chrome.notifications.clear(id)
})
```

- [ ] **Step 7: Commit**

```bash
git add scripts/make-icon.mjs extension/
git commit -m "feat: scaffold MV3 call-panel extension (manifest, side panel, sw, icons)"
```

---

## Task 8: Pin the extension ID and fill placeholders

**Files:**
- Create: `extension/.signing-key.pem` (git-ignored), `extension/.pub.der` (git-ignored)
- Modify: `.gitignore`
- Modify: `extension/manifest.json` (`__MANIFEST_KEY__`)
- Modify: `next.config.ts` (`__EXTENSION_ID__`)

Run all shell steps in **Git Bash** (openssl + base64 available).

- [ ] **Step 1: Ignore the signing artifacts**

Append to `.gitignore`:

```
# Chrome extension signing key (never commit)
extension/.signing-key.pem
extension/.pub.der
```

- [ ] **Step 2: Generate the key and derive the public DER**

```bash
openssl genrsa -out extension/.signing-key.pem 2048
openssl rsa -in extension/.signing-key.pem -pubout -outform DER -out extension/.pub.der 2>/dev/null
```

- [ ] **Step 3: Print the manifest key**

Run: `base64 -w0 extension/.pub.der; echo`
Copy the printed string. In `extension/manifest.json`, replace `__MANIFEST_KEY__`
with it (keep the surrounding quotes).

- [ ] **Step 4: Compute the extension ID**

Run:
```bash
node -e "const c=require('crypto'),fs=require('fs');const d=fs.readFileSync('extension/.pub.der');const h=c.createHash('sha256').update(d).digest();let id='';for(let i=0;i<16;i++){id+=String.fromCharCode(97+(h[i]>>4))+String.fromCharCode(97+(h[i]&15));}console.log(id)"
```
Copy the 32-character ID. In `next.config.ts`, replace `__EXTENSION_ID__` with it.

- [ ] **Step 5: Rebuild and confirm the CSP value**

Run: `npm run build`
Expected: build succeeds with the real extension id baked into the header.

- [ ] **Step 6: Commit (key files are git-ignored and will not be staged)**

```bash
git add .gitignore extension/manifest.json next.config.ts
git commit -m "feat: pin extension id and apply it to manifest key and CSP"
```

---

## Task 9: Verification

**Files:** none (verification only). Requires the app deployed to
`https://www.megestic.com` with Tasks 1–8 shipped. For purely local verification,
see the dev note at the end.

- [ ] **Step 1: Endpoint rejects anonymous requests**

Run: `curl -s -o /dev/null -w "%{http_code}\n" https://www.megestic.com/api/calls/webrtc-token`
Expected: `401`

- [ ] **Step 2: `/panel` carries the frame-ancestors header**

Run: `curl -sI https://www.megestic.com/panel | grep -i content-security-policy`
Expected: a line containing `frame-ancestors chrome-extension://<your id>`

- [ ] **Step 3: Load the extension**

In Chrome: `chrome://extensions` → enable Developer mode → "Load unpacked" →
select the `extension/` folder. Confirm the listed extension ID **matches** the ID
computed in Task 8 (proves the pinned key works).

- [ ] **Step 4: Manual end-to-end**

- Click the toolbar icon → side panel opens showing the login form.
- Sign in with a Hourglass agent account → dialer appears.
- Close and reopen the side panel → still signed in (session persisted).
- For each of the 5 numbers: select it in **From**, dial a test number, confirm the
  call connects with that caller ID and the active-call HUD appears.
- Place an inbound call to a Hourglass number → the incoming popup shows **and** a
  Chrome notification fires; the toolbar shows the active badge. Answer, mute,
  send a DTMF digit, hang up → badge clears.

- [ ] **Step 5: Negative framing check**

In any normal web page's devtools console, run:
```js
const f = document.createElement("iframe"); f.src = "https://www.megestic.com/panel"; document.body.appendChild(f)
```
Expected: the frame is **refused** (console reports a frame-ancestors / CSP violation), proving only the extension may embed it.

- [ ] **Step 6: Permissions audit**

Open the extension's details in `chrome://extensions`. Confirm permissions are only
**sidePanel** and **notifications**, and site access is limited to
`www.megestic.com`. No content scripts, no broad host access.

---

## Local-only dev note (optional)

To exercise the extension against `localhost` before deploying:
1. Temporarily set the iframe `src` in `extension/side-panel.html` to
   `http://localhost:3000/panel`.
2. Temporarily add `"http://localhost:3000/*"` to `host_permissions` in
   `extension/manifest.json`.
3. Temporarily set `PANEL_ORIGIN` in `extension/panel.js` to
   `http://localhost:3000`.
4. Run `npm run dev`, reload the unpacked extension, and test.
Revert all three before shipping. These are local-only changes; do not commit them.
```
