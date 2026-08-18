# Hourglass Mobile

A Next.js 16 web app bootstrapped with shadcn/ui, Tailwind CSS v4, and TypeScript — set up as the foundation for the Hourglass Mobile project.

---

## Tech Stack

| Tool | Version | Purpose |
|---|---|---|
| [Next.js](https://nextjs.org/) | 16.2.6 | App framework (App Router) |
| [React](https://react.dev/) | 19 | UI runtime |
| [TypeScript](https://www.typescriptlang.org/) | 5 | Type safety |
| [Tailwind CSS](https://tailwindcss.com/) | v4 | Utility-first styling |
| [shadcn/ui](https://ui.shadcn.com/) | 4.8.3 | Accessible component library |
| [Radix UI](https://www.radix-ui.com/) | 1.4.3 | Unstyled accessible primitives |
| [next-themes](https://github.com/pacocoursey/next-themes) | 0.4.6 | Dark/light mode |
| [tw-animate-css](https://github.com/Wombosvideo/tw-animate-css) | 1.4.0 | Tailwind-compatible animation utilities |
| [@tabler/icons-react](https://tabler.io/icons) | 3.44.0 | Icon set |
| [class-variance-authority](https://cva.style/) | 0.7.1 | Component variant styling |
| [clsx](https://github.com/lukeed/clsx) | 2.1.1 | Conditional class names |
| [tailwind-merge](https://github.com/dcastil/tailwind-merge) | 3.6.0 | Merge Tailwind classes without conflicts |
| [Prettier](https://prettier.io/) | 3.8.3 | Code formatter |
| [ESLint](https://eslint.org/) | 9 | Linter |

---

## Project Setup (What Was Done)

### 1. Next.js + shadcn/ui Template (with Custom Preset)

Initialized using the shadcn/ui Next.js template with a **custom preset**:

```bash
npx shadcn@latest init --preset bMn684WAy
```

The preset `bMn684WAy` applies an opinionated starting configuration (fonts, colors, radius, and component defaults) on top of the base template. It pre-configures:
- App Router (`app/` directory)
- TypeScript strict mode
- Tailwind CSS v4 via `@tailwindcss/postcss`
- shadcn/ui design token system using **OKLCH color space** in `app/globals.css`
- `@/*` path alias pointing to the project root (configured in `tsconfig.json`)

### 2. Custom Fonts (Google Fonts via `next/font`)

Three fonts are configured in [app/layout.tsx](app/layout.tsx) and exposed as CSS variables:

| Variable | Font | Used For |
|---|---|---|
| `--font-heading` | Inter | Headings |
| `--font-sans` | DM Sans | Body / general text |
| `--font-mono` | Geist Mono | Code / monospace |

### 3. Dark Mode

- Powered by `next-themes` via the `ThemeProvider` in [components/theme-provider.tsx](components/theme-provider.tsx)
- Default theme follows the OS/system preference (`defaultTheme="system"`)
- Keyboard shortcut: press **`d`** anywhere on the page to toggle between dark and light mode (does not trigger when focused inside inputs, textareas, selects, or contenteditable elements)

### 4. Design Tokens (CSS Variables)

`app/globals.css` defines a full set of semantic color tokens for both `:root` (light) and `.dark` (dark) using the OKLCH color space. Tokens include:

- `--background`, `--foreground`
- `--primary`, `--secondary`, `--muted`, `--accent`, `--destructive`
- `--card`, `--popover`, `--border`, `--input`, `--ring`
- `--chart-1` through `--chart-5` (data visualization)
- `--sidebar-*` variants for sidebar components
- `--radius` and derived radius scale (`--radius-sm` → `--radius-4xl`)

All tokens are mapped into Tailwind's theme via `@theme inline` so you can use them as Tailwind utilities (e.g., `bg-primary`, `text-muted-foreground`, `rounded-xl`).

### 5. shadcn/ui Components Installed

| Component | Location |
|---|---|
| Button | [components/ui/button.tsx](components/ui/button.tsx) |

To add more components:

```bash
npx shadcn@latest add <component-name>
# example:
npx shadcn@latest add card
npx shadcn@latest add input
```

Components are placed in `components/ui/`.

### 6. AI Agent Tooling

Three AI agent integrations were added to the project to assist development.

#### shadcn/ui MCP Server

Initialized via:

```bash
npx shadcn@latest mcp init --client claude
```

This generated [.mcp.json](.mcp.json) which registers two MCP (Model Context Protocol) servers that Claude Code can talk to:

| Server | Command | What it does |
|---|---|---|
| `shadcn` | `npx shadcn@latest mcp` | Lets Claude search, browse, and add shadcn/ui components directly from the AI chat |
| `next-devtools` | `npx next-devtools-mcp@latest` | Exposes Next.js dev tools (docs, component calls, cache, upgrade helpers) to Claude |

These servers are **project-local** — they only activate when working inside this repo with Claude Code.

#### shadcn/ui Claude Skill

```bash
npx skills add shadcn/ui
```

Installs the `shadcn/ui` skill into Claude Code, giving it deep knowledge of component APIs, usage patterns, and best practices for this specific stack.

#### UI/UX Pro Max Design Agent

The `ui-ux-pro-max` Claude skill was added for design work. It provides:
- 67 UI styles (glassmorphism, brutalism, bento grid, etc.)
- 96 color palettes, 57 font pairings
- Stack-specific guidance for Next.js + shadcn/ui
- Triggers on design tasks: layout, color, typography, component design, accessibility

### 7. Code Quality Tools

**Prettier** ([.prettierrc](.prettierrc)):
- No semicolons, double quotes, 2-space indent, LF line endings
- `prettier-plugin-tailwindcss` auto-sorts Tailwind classes on save
- Tailwind functions `cn` and `cva` are recognized for class sorting

**ESLint** ([eslint.config.mjs](eslint.config.mjs)):
- `eslint-config-next/core-web-vitals` — Next.js best practices + Core Web Vitals rules
- `eslint-config-next/typescript` — TypeScript-aware linting

---

## Directory Structure

```
hourglass-mobile/
├── app/
│   ├── globals.css         # Tailwind imports + design tokens (OKLCH)
│   ├── layout.tsx          # Root layout: fonts, ThemeProvider
│   ├── page.tsx            # Home page (starter placeholder)
│   └── favicon.ico
├── components/
│   ├── theme-provider.tsx  # Dark/light mode provider + keyboard shortcut
│   └── ui/
│       └── button.tsx      # shadcn/ui Button component
├── hooks/                  # Custom React hooks (empty, ready to use)
├── lib/                    # Utilities (e.g., cn() helper — empty, ready to use)
├── public/                 # Static assets
├── .mcp.json               # MCP server config for Claude Code (shadcn + next-devtools)
├── AGENTS.md               # Agent rules: notes for AI agents working in this repo
├── .prettierrc             # Prettier config
├── eslint.config.mjs       # ESLint config
├── next.config.ts          # Next.js config
├── tsconfig.json           # TypeScript config
└── package.json
```

> `hooks/`, `lib/`, `public/`, and `components/` (root level) contain `.gitkeep` files to preserve the empty directories in git.

---

## Getting Started

### Prerequisites

- Node.js 18.17 or later
- npm (comes with Node.js)

### Install dependencies

```bash
npm install
```

### Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Other scripts

```bash
npm run build       # Production build
npm run start       # Start production server
npm run lint        # Run ESLint
npm run format      # Format all .ts/.tsx files with Prettier
npm run typecheck   # Type-check without emitting files
```

---

## Adding Components

```bash
# Add a shadcn/ui component
npx shadcn@latest add <name>

# Then import it
import { ComponentName } from "@/components/ui/component-name"
```

## Using the `cn` Utility

The `cn` helper merges Tailwind classes safely (no conflicting duplicates):

```ts
import { cn } from "@/lib/utils"

cn("px-4 py-2", isActive && "bg-primary", className)
```

---

## Notes for Developers

- This project uses **Next.js 16** (App Router only). The Pages Router is not used.
- **Tailwind v4** has a different config format from v3 — there is no `tailwind.config.js`. All theme customization is done in `app/globals.css` using `@theme inline`.
- Design tokens use **OKLCH** color values (not hex/rgb). This is intentional — OKLCH provides perceptually uniform color scaling and better dark mode contrast.
- The `@/*` alias maps to the project root, so `@/components/ui/button` resolves to `./components/ui/button.tsx`.

## Jades AI event integration

The Jades AI polls a read-only endpoint for new comms events.

**Endpoint:** `GET /api/jades/events?since=<ISO8601>&limit=<n>`
**Auth:** `Authorization: Bearer <JADES_API_TOKEN>` (required)

Returns inbound **and** outbound calls, SMS, and voicemails created after
`since`, plus `latest_timestamp` for the next poll:

```json
{
  "events": [
    {
      "type": "call" | "sms" | "voicemail",
      "direction": "inbound" | "outbound",
      "from": "+1832...",
      "to": "+1832...",
      "phone_label": "TLP" | "STR" | "BB" | "HGI",
      "timestamp": "2026-07-06T21:00:00.000Z",
      "duration_sec": 120,
      "transcript": null,
      "body": "SMS text",
      "status": "missed" | "answered" | "sent" | "received",
      "audio_url": "https://..."
    }
  ],
  "latest_timestamp": "2026-07-06T21:00:00.000Z"
}
```

`phone_label` is passed straight from `phone_numbers.label`. `transcript` is
`null` (Jades transcribes from `audio_url`, present on voicemails).

**Env vars:**

- `JADES_API_TOKEN` — **required** bearer token for the endpoint. If unset the
  endpoint returns `503`. Share the same value with Jades.
- `JADES_WEBHOOK_URL`, `JADES_WEBHOOK_SECRET` — **optional**, only for the
  real-time push path (`lib/jades/deliver.ts`, dormant while Jades polls). Leave
  unset unless you enable push.

See `docs/superpowers/specs/2026-07-07-jades-event-integration-design.md`.

## AI voice agent (TLP test)

Inbound calls to brands listed in `AI_AGENT_LABELS` ring their agents first and
fall to a Telnyx AI Assistant only when a human isn't going to take the call:
nobody online or available on mobile, every dial failing, or nobody answering
within `AI_AGENT_RING_TIMEOUT_SECS`. On every other brand those three cases still
go to voicemail, unchanged. The call is recorded (dual channel);
when the conversation ends, the full transcript is stored in
`call_transcript_segments` (visible in the dashboard call history) and posted
to Slack, followed by a signed recording link. If insights are configured on
the assistant in the Telnyx portal, an AI summary message is posted too.

**Env vars** (feature is fully dormant unless the first two are set):

| Var | Purpose |
|---|---|
| `TELNYX_AI_ASSISTANT_ID` | Assistant ID from Telnyx portal → AI → AI Assistants |
| `AI_AGENT_LABELS` | Comma-separated `phone_numbers.label` values to enable (e.g. `TLP`) |
| `AI_AGENT_RING_TIMEOUT_SECS` | Optional; how long agents ring on an AI brand before the assistant takes over. Default 20, clamped to 5–60. Non-AI brands always use 25. Don't go far below 20: mobile agents are woken by FCM push, and that wake happens inside this window |
| `AI_BRAND_NAMES` | Optional label→spoken-name map, e.g. `TLP:The Launch Pad` — used by the AI's greeting and Slack headers |
| `SLACK_WEBHOOK_URL` | Slack incoming-webhook URL for transcripts |
| `SLACK_WEBHOOK_URL_<LABEL>` | Optional per-brand override (e.g. `SLACK_WEBHOOK_URL_TLP`) |
| `APP_BASE_URL` | Optional; adds an "Open dashboard" link to Slack messages |

**One-time prerequisites:** run in the Supabase SQL editor

```sql
alter table calls add column ai_handled boolean not null default false;
alter table calls add column ai_conversation_id text;
alter table calls add column ai_recording_path text;
```

and create a **private** storage bucket named `call-recordings`.

See `docs/superpowers/specs/2026-08-13-tlp-ai-voice-slack-design.md`.
