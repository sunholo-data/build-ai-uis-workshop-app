---
name: workshop-demo-builder
description: >-
  Add or build a new /dev demo, playground, or page in this workshop app that
  renders A2UI (declarative JSON/component-tree UI) or embeds an MCP Apps widget
  (sandboxed iframe). This is the right skill for ANY request to create a new
  demo built from A2UI or MCP Apps. Use whenever the user wants to add, create,
  make, scaffold, or build a demo, playground, /dev surface, A2UI surface, or
  MCP App widget — including phrasings like "make me a demo that renders a form
  from A2UI JSON", "add an MCP App widget demo", "add a new playground under
  /dev", "new /dev surface", "make a demo that does X", or "build an A2UI
  counter/card/form". Also covers the matching exercise doc and how to register
  the demo in the index. NOT for AG-UI, file-browser, or rich-media, which are
  already-built fixtures.
---

# Workshop demo builder

You're helping someone add a **new demo** to the `/dev` playground area of this
workshop app. This skill is written for a fresh Claude Code session with **no
prior knowledge of this repo** — it gives you the verified files, symbols, and
conventions so you can build a working demo in one pass instead of
reverse-engineering the codebase.

Two kinds of demo are in scope:

- **A2UI demo** — a declarative UI described as JSON that one generic renderer
  draws. "UI is data the agent emits, not React you ship."
- **MCP Apps demo** — an interactive widget loaded *by reference* and run in a
  *separate-origin sandbox*, with two standard channels to talk back to the
  agent.

If the user asks for AG-UI, file-browser, or rich-media, that's **out of
scope** — those already exist as fixtures under `/dev`; point them at
[the dev index](../../../frontend/src/app/dev/page.tsx) instead of building new.

## First: which kind, and does it need a key?

Ask (or infer) two things before touching files:

1. **A2UI or MCP App?** A2UI = "render this form / card / counter from JSON."
   MCP App = "embed an interactive widget (map, slider, sim) that reports back
   what the user did." If they want a *chart/form/layout*, it's A2UI. If they
   want an *embedded interactive third-party-style widget*, it's an MCP App.
2. **No-key by default.** The whole `/dev` area is designed to work **offline,
   with no API key** — demos render from bundled fixtures. Keep it that way: the
   default demo must render and be interactive without a Gemini key or a live
   backend. A live agent turn is an *optional* "go further" step, never the
   baseline. This is a hard guardrail — see [Guardrails](#guardrails).

Ground yourself first: skim [the dev index](../../../frontend/src/app/dev/page.tsx)
and the exercise docs in [docs/exercises/](../../../docs/exercises/) so the new
demo matches house style.

## Ports and how to run (verified)

Everything comes up with **`make dev-local`** from the repo root (no GCP creds,
in-memory backend):

| Service | Port | Needed for |
|---|---|---|
| Frontend (Next.js) | `3456` | every demo — open `http://localhost:3456/dev` |
| Backend (FastAPI + ADK) | `1956` | only the optional live-agent "go further" step |
| MCP sandbox proxy | `3457` | rendering an MCP App iframe (separate-origin) |
| Local demo MCP server | `3001` | the bundled MCP App widget |

An A2UI seed-only demo needs just the frontend. An MCP App live iframe needs the
sandbox (`3457`) and a server (`3001`). The MCP App **synthetic-button** path
needs only the frontend — that's its no-key baseline.

---

## Pattern A — a new A2UI demo

**What renders it:** a `<SurfaceRegistryProvider>` wraps the page; you mount an
`<A2UISurfaceMount>` and seed it with hand-authored A2UI **v0.9** messages via
`useSurfaceRegistry().appendMessages(...)`. One renderer (`@a2ui/react/v0_9`)
draws whatever component tree you feed it.

**Files to touch — two:**

1. **New page:** copy
   [frontend/src/app/dev/a2ui/page.tsx](../../../frontend/src/app/dev/a2ui/page.tsx)
   to `frontend/src/app/dev/<your-name>/page.tsx`. The route is the folder name
   (`/dev/<your-name>`). Swap the JSON, not the plumbing.
2. **Register it:** add a `DevRoute` entry to the `PLAYGROUNDS` array in
   [frontend/src/app/dev/page.tsx](../../../frontend/src/app/dev/page.tsx).

**What to swap inside the page** (symbol names verified against the source):

- `PATTERN1_SURFACE_ID`, `PATTERN1_SKILL_ID`, `PATTERN1_SESSION_ID` — rename to
  your demo's ids.
- `PATTERN1_SEED_MESSAGES` — the heart of it. Three v0.9 messages:
  - `createSurface` — declares **only** `surfaceId` + `catalogId`
    (`basicCatalog.id`). **Do not** put components here; they're silently
    dropped and the surface renders `[Loading root...]` forever.
  - `updateComponents` — the component tree. Root component id is `"root"` by
    convention. Each node is `{ id, component, ... }`; containers use
    `children: [...ids]`.
  - `updateDataModel` — the data the bindings read. Shape is
    `{ surfaceId, path: "/", value: {...} }` — **not** `{ surfaceId, data }`
    (a `data` blob is ignored and bindings resolve to nothing).
- **Data binding** is the teachable idea: a component reads a value with
  `text: { path: "/counterDisplay" }`, and `updateDataModel`'s `value` supplies
  `{ counterDisplay: "..." }`. At runtime the agent edits the *value*, not the
  markup — that's the point of binding.

**Simplest no-key version:** the copied page's live click needs the backend +
the `demo-click-counter` skill. For a purely declarative no-key demo, keep the
`Pattern1Seeder` + `<A2UISurfaceMount>` but **remove `triggerOnAction`** and the
session-bootstrap effect, so it just seeds and renders. Add the click-driven
agent turn back only as an optional "go further (needs a key)" step.

A ready-to-fill, trimmed template is in
[resources/a2ui-page-template.tsx](resources/a2ui-page-template.tsx). The
component vocabulary (Column, Row, Text, Button, TextField, …) is the
`basicCatalog`; grep `@a2ui/react` or read
[docs/exercises/a2ui.md](../../../docs/exercises/a2ui.md) for examples.

---

## Pattern B — a new MCP App demo

**What renders it:** `<MCPAppToolCallRouter>` takes a *fixture tool call* and an
MCP client, finds the tool's `ui://` resource, and renders it in a sandboxed
iframe via the sandbox proxy on `:3457`. The widget talks back on two channels
(explained below). Both `/dev/mcp-apps/active` and `/dev/mcp-apps/passive`
render from the **same server list**, so adding a server there gives you a demo
on both pages for free — you usually **don't** write a new page.

**Files to touch — one or two:**

1. **Add a server option (required):** append a `ServerOption` to
   `SERVER_OPTIONS` in
   [frontend/src/app/dev/mcp-apps/_shared.tsx](../../../frontend/src/app/dev/mcp-apps/_shared.tsx).
   Fields (verified): `id`, `label`, `displayUrl`, `description`, `serverId`,
   `connect` (`{ kind: "direct", url }` for a CORS-enabled local server, or
   `{ kind: "proxy", target }` for a CORS-blocked remote one), `toolCall` (a
   `ToolCallState` fixture), `runHint` (a `ReactNode` telling the user how to
   start the server / why it's blank).
   - The `toolCall` fixture shape:
     `{ id, name, status: "success", parentMessageId, argsJson: "{}", resultContent: "" }`.
     `name` **must** be a tool the server exposes that binds to a `ui://`
     resource. Empty `resultContent` is fine — the widget renders its own
     default state from the `ui://` resource.
2. **Add a new MCP server (optional):** only if no existing server exposes the
   widget you want. Copy
   [infrastructure/mcp-local-demo/](../../../infrastructure/mcp-local-demo/)
   (`serve.ts` + `widget.html`) as the template — a stateless Streamable-HTTP
   MCP server that serves one tool with a `ui://` resource. Wire its port into
   [scripts/dev-local.sh](../../../scripts/dev-local.sh) so `make dev-local`
   starts it.

**The two channels back to the agent** (this is what the demo should teach):

- **`app/notify` → chat turn.** The widget asks the host to take a turn; the
  host adapter
  [frontend/src/components/protocols/mcpAppNotificationAdapter.ts](../../../frontend/src/components/protocols/mcpAppNotificationAdapter.ts)
  (`notificationToChatMessage`, `locationSelected`) translates it into a message
  the user "would have typed."
- **`ui/update-model-context` → structured state.** No chat turn — it merges
  on-screen state into the agent's next-turn context.

**No-key baseline:** the `active` page's **Synthetic notifications** panel fires
these payloads straight through the adapter with no iframe and no server — that
works with just the frontend. The live iframe (real widget) is the "go further"
step needing `make dev-local`.

A ready-to-fill template is in
[resources/mcp-server-option-template.tsx](resources/mcp-server-option-template.tsx).

---

## The exercise doc (do this too)

House style: **every demo ships with a matching teaching doc** in
[docs/exercises/](../../../docs/exercises/), following the exact shape used by
[a2ui.md](../../../docs/exercises/a2ui.md) and
[mcp.md](../../../docs/exercises/mcp.md):

> **the problem → the protocol → try it (no key) → teachable edit → the
> one-liner you teach back**

Then add a row to the table in
[docs/exercises/README.md](../../../docs/exercises/README.md). Keep the "try it"
steps no-key, name the exact file + symbol the attendee edits, and end with a
one-sentence teach-back. A copy-paste skeleton is in
[resources/exercise-doc-template.md](resources/exercise-doc-template.md).

## Verify before you hand it back

- Run `make dev-local`, open `http://localhost:3456/dev`, confirm your demo is
  listed and renders **without a key**.
- Frontend quality gate: `cd frontend && npm run quality:check:fast`
  (lint + typecheck). Fix anything red before declaring done.
- If you added an MCP server, confirm it starts under `make dev-local` and the
  widget renders on `/dev/mcp-apps/passive`.

## Guardrails

- **No-key / offline by default.** The demo must render and be interactive with
  no Gemini key and no live backend. Live agent turns are optional extras.
- **Don't leak anything.** Demos use only bundled fixtures and made-up data
  (Munich, a click counter, a toy sim). Never wire a demo to a real customer
  bucket, private document, or authenticated endpoint — this is a public
  teaching app. If a demo idea needs private content, stop and reshape it around
  a fixture.
- **Match the teaching style.** Every demo is a *fixture you can read* — keep the
  code explicit and narrated (the existing pages log each wire frame to the
  console on purpose). Don't add build steps, generators, or indirection; a
  workshop attendee should be able to open the page and understand it.
- **Stay in scope.** A2UI and MCP Apps only. Don't rebuild AG-UI, file-browser,
  or rich-media.

## Why these patterns (design docs)

Point curious attendees at the specs that justify the shapes above:

- A2UI click-driven pattern —
  [docs/design/v6.1.0/implemented/action-triggered-agent-turn.md](../../../docs/design/v6.1.0/implemented/action-triggered-agent-turn.md)
  and the workshop-demo design
  [docs/design/v6.1.0/a2ui-workshop-demo.md](../../../docs/design/v6.1.0/a2ui-workshop-demo.md).
- MCP Apps integration —
  [docs/design/v6.1.0/implemented/mcp-app-integrations.md](../../../docs/design/v6.1.0/implemented/mcp-app-integrations.md).
- Separate-origin sandbox (why the iframe can't read your cookies) —
  [docs/design/v6.1.0/implemented/mcp-sandbox-separate-origin.md](../../../docs/design/v6.1.0/implemented/mcp-sandbox-separate-origin.md)
  and the ops guide
  [docs/ops/mcp-apps-iframe-guide.md](../../../docs/ops/mcp-apps-iframe-guide.md).
- The four-protocol stack in general — the `agent-protocols` skill.
