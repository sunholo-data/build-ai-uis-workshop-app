---
name: workshop-demo-builder
description: >-
  Build a new workshop demo in this app from A2UI (declarative JSON UI) or MCP
  Apps (sandboxed iframe widgets). This is the right skill for ANY request to
  create a new demo, skill, or playground built from those protocols. Two
  targets: (1) a real chat skill that appears at /chat/@workshop-user/<slug> and
  emits A2UI or renders an MCP App widget live in the product chat (the default
  — needs a Gemini key), and (2) a no-key /dev fixture page for offline
  teaching. Use whenever the user wants to add, create, make, scaffold, or build
  a demo, chat skill, playground, A2UI surface, or MCP App widget — including
  "make me a demo/skill that does X", "add a skill that shows up in chat", "a
  form in chat from A2UI", "add an MCP App widget", or "new /dev playground". NOT
  for AG-UI, file-browser, or rich-media (already-built fixtures).
---

# Workshop demo builder

You're helping someone add a **new demo** to this workshop app, built from
**A2UI** (declarative JSON UI) or **MCP Apps** (sandboxed iframe widgets). This
skill assumes a fresh Claude Code session with **no prior repo knowledge** — it
gives you the verified files, symbols, and conventions to do it in one pass.

There are **two targets**, and they are different artifacts. Pick deliberately
and **tell the user which one you're building and how to open it** — don't
silently default.

| | **Chat skill** (default) | **/dev fixture** (fallback) |
|---|---|---|
| What | A real platform skill: an agent you chat with | A standalone frontend teaching page |
| Where you open it | `/chat/@workshop-user/<slug>` — in the product | `http://localhost:3456/dev/<name>` |
| Defined in | `backend/db/local_fixture.py` (`_demo_skills`) | one file under `frontend/src/app/dev/` |
| Emits A2UI / renders widget | **live**, at runtime, via the agent | from a hand-authored seed |
| Needs a Gemini key? | **Yes** — the agent runs a live turn | **No** — renders offline |
| Feels like | the product; the "wow" | a fixture you read to learn the protocol |

**The strong default is BOTH**, and they should reference each other: build the
live **chat skill** (the wow) *and* a no-key **`/dev` fixture** (works offline,
and is the artifact attendees read to learn the protocol), then cross-link them
— the chat skill's `description` points at the fixture, the fixture's header
comment points at the chat skill. That pair *is* a good workshop demo. Build
**only** the `/dev` fixture when there's **no Gemini key** (the fixture is cheap
and key-free); there's rarely a reason to ship the chat skill *without* the
fixture. Whatever you build, say which artifacts exist and how to open each.

If the user asks for AG-UI, file-browser, or rich-media, that's **out of scope**
— those already exist; point them at
[the dev index](../../../frontend/src/app/dev/page.tsx).

## First: pick target + protocol

1. **Both, or just the /dev fixture?** With a key, build both (chat skill +
   no-key fixture, cross-linked — see above). Without a key, build the /dev
   fixture only.
2. **A2UI or MCP App?** A2UI = "render a form/card/counter/layout from JSON."
   MCP App = "embed an interactive widget (map, slider, sim) that reports back."
3. **Key check.** The chat skill's live turn needs a Gemini key: set
   `GOOGLE_API_KEY` (Gemini Express Mode, `GOOGLE_GENAI_USE_VERTEXAI=false`) in
   `backend/.env`; `make dev-local` loads it. No key available? Build the /dev
   fixture instead and say so.

**Before authoring any A2UI, read the verified catalog:
[resources/a2ui-catalog.md](resources/a2ui-catalog.md)** — all 18 `basicCatalog`
components with props/variants, so you never grep `node_modules` or guess. Most
important: the catalog **has `ChoicePicker` (dropdown / radio / multi-select),
`CheckBox`, `Slider`, and `DateTimeInput`** — so "choices / a dropdown / pick one
/ a rating / a date" uses **those**, not guided TextFields. It is not just
Column/Row/Text/TextField/Button/Divider; don't tell the user the catalog can't
express choices — it can.

Ground yourself: skim the seeded skills in
[backend/db/local_fixture.py](../../../backend/db/local_fixture.py) (`demo-form-builder`
= A2UI form in chat; `demo-map-explorer` = MCP App widget in chat;
`demo-click-counter` = action-driven A2UI) and the exercise docs in
[docs/exercises/](../../../docs/exercises/).

## Ports (via `make dev-local`)

Frontend `3456` · Backend `1956` · MCP sandbox `3457` · Local demo MCP `3001`.
Chat skills need the backend **and** a Gemini key. `/dev` fixtures need only the
frontend (MCP-App iframes also need `3457` + a server).

---

## Target 1 (default) — a chat skill at `/chat/@workshop-user/<slug>`

A chat skill is a dict in the list returned by `_demo_skills(now)` in
[backend/db/local_fixture.py](../../../backend/db/local_fixture.py). Most entries
spread a shared `base` (owner = `workshop-user`, public access, model
`gemini-flash-lite-latest`) then set `skillId`, `slug`, `displayName`, `name`,
`description`, `instructions`, `initialMessage`. The `slug` **is** the URL:
`/chat/@workshop-user/<slug>` (the handle is the owner id, `workshop-user`).

Fill-in templates (both shapes) are in
[resources/chat-skill-fixture-template.py](resources/chat-skill-fixture-template.py).

### A2UI chat skill

- **No tool to declare.** `send_a2ui_json_to_client` (the A2UI emit tool,
  [backend/adk/a2ui.py](../../../backend/adk/a2ui.py)) is available to every
  skill — `demo-form-builder` emits A2UI with `base`'s `tools: []`.
- The **`instructions`** are the work: spell out the exact A2UI **v0.9** tree the
  agent must emit. Copy `demo-form-builder` (loose "build a form") or
  `demo-click-counter` (precise, action-driven, exact tree) as the model.
- The **same A2UI contract + gotchas** apply to the JSON the agent emits:
  `createSurface` = only `surfaceId` + `catalogId`; root component id `"root"`;
  `updateDataModel` = `{ surfaceId, path, value }` (not `{ data }`); bind with
  `{ path: "/field" }`. **Text `variant`: only `h1`–`h5` and `body` are safe —
  `caption` renders a literal `<caption>` element (illegal outside a `<table>`)
  → a hydration error.** `Button` takes `child` + `action`, not `label`. Full
  component vocabulary + the choices answer:
  [resources/a2ui-catalog.md](resources/a2ui-catalog.md). Embed these same
  constraints **in the agent's `instructions`** — the model emits the A2UI at
  runtime, so it needs the guardrails (name the allowed components, forbid
  `caption`, say which control to use for choices).
- Optional: `toolConfigs.a2ui.default_surface: "workspace"` routes the surface to
  a persistent pane instead of inline-in-chat (see `demo-workspace-interactive`).

### MCP App chat skill

- Needs its **own `skillMetadata`** (not `base`'s): `tools: ["mcp"]` +
  `toolConfigs.mcp.servers: ["<server-id>"]` (+ `allow_context_writes:
  ["<server-id>"]` to accept the widget's write-back channel).
- The `mcp_servers/<id>` doc must be seeded in `seed_local_fixture()` — reuse
  `"local-demo"` (already points at `http://127.0.0.1:3001/mcp`) unless you stood
  up your own server (copy [infrastructure/mcp-local-demo/](../../../infrastructure/mcp-local-demo/)).
- `instructions` tell the agent to call the widget's tool (e.g. `show-demo`)
  once. Copy `demo-map-explorer` as the model. The widget renders inline in chat
  via `MCPAppToolCallRouter`.

### Register + open it

1. Add your dict to the `_demo_skills(now)` list.
2. **Restart `make dev-local`.** The seeder only runs when the skills collection
   is empty, and LOCAL_MODE's store is in-memory (resets on boot) — a fresh boot
   re-seeds with your skill. (`backend/db/local_fixture.py:62` — `if not skills:`.)
3. Open `http://localhost:3456/chat/@workshop-user/<slug>` and chat with it. If
   the agent errors on the turn, it's almost always a missing/invalid Gemini key.

---

## Target 2 (fallback) — a no-key `/dev` fixture

Use when there's no key or you want an offline, read-the-code teaching surface.
An A2UI `/dev` page renders a **hand-authored seed** (no agent); an MCP App
`/dev` route renders a fixture tool call. Two small steps, no backend, no key.

- **A2UI fixture:** copy [resources/a2ui-page-template.tsx](resources/a2ui-page-template.tsx)
  to `frontend/src/app/dev/<name>/page.tsx` (swap the three seed messages), and
  add a `DevRoute` to the `PLAYGROUNDS` array in
  [frontend/src/app/dev/page.tsx](../../../frontend/src/app/dev/page.tsx). Full
  reference: [frontend/src/app/dev/a2ui/page.tsx](../../../frontend/src/app/dev/a2ui/page.tsx).
  Same A2UI contract + gotchas as above (incl. the `caption` trap); component
  vocabulary in [resources/a2ui-catalog.md](resources/a2ui-catalog.md).
- **MCP App fixture:** add a `ServerOption` to `SERVER_OPTIONS` in
  [frontend/src/app/dev/mcp-apps/_shared.tsx](../../../frontend/src/app/dev/mcp-apps/_shared.tsx);
  the active/passive pages pick it up. Template:
  [resources/mcp-server-option-template.tsx](resources/mcp-server-option-template.tsx).

---

## The exercise doc (do this for either target)

Every demo ships with a teaching doc in
[docs/exercises/](../../../docs/exercises/), following the house shape used by
[a2ui.md](../../../docs/exercises/a2ui.md) / [mcp.md](../../../docs/exercises/mcp.md):
**problem → protocol → try it → teachable edit → the one-liner you teach back.**
For a chat skill the "try it" is "open `/chat/@workshop-user/<slug>` and ask X";
for a `/dev` fixture it's the no-key edit-the-JSON path. Add a row to
[docs/exercises/README.md](../../../docs/exercises/README.md). Skeleton:
[resources/exercise-doc-template.md](resources/exercise-doc-template.md).

## Verify before you hand it back

- **Chat skill (seeded + served):** run
  `scripts/verify-chat-skill.sh <slug>` — it curls the by-slug API with the
  LOCAL_MODE stub token and confirms the skill resolves (no browser). A clean way
  to catch "forgot to restart `make dev-local` after editing `local_fixture.py`."
- **Chat skill (live turn):** open `/chat/@workshop-user/<slug>` with a key, send
  a prompt, confirm the A2UI/widget renders. (The script above proves it exists,
  not that the emitted A2UI parses — only a real turn does that.)
- **/dev fixture:** open `http://localhost:3456/dev/<name>`, confirm it renders
  with no key.
- **Both:** `cd frontend && npm run quality:check:fast` (lint + typecheck) and,
  for backend edits, `cd backend && make lint`. Fix anything red.

## Guardrails

- **Say which target you built and how to open it.** The failure that started
  this skill was silently shipping a `/dev` fixture when the user expected a chat
  entry. Make the choice explicit.
- **A key gates the chat skill, not the whole demo.** If no key is available,
  build the `/dev` fixture (no-key) and say the chat version needs a key — don't
  fake a live agent.
- **Don't leak.** Fixtures and made-up data only (a click counter, a toy sim,
  Munich). Never wire a demo to a real customer bucket, private doc, or
  authenticated endpoint — this is a public teaching app.
- **Match the teaching style.** Demos are fixtures you can read: explicit,
  narrated, no generators or indirection.
- **Stay in scope:** A2UI + MCP Apps only. Not AG-UI, file-browser, or rich-media.

## Why these patterns (design docs)

- A2UI action-driven pattern —
  [docs/design/v6.1.0/implemented/action-triggered-agent-turn.md](../../../docs/design/v6.1.0/implemented/action-triggered-agent-turn.md);
  workshop demo — [docs/design/v6.1.0/a2ui-workshop-demo.md](../../../docs/design/v6.1.0/a2ui-workshop-demo.md).
- MCP Apps —
  [docs/design/v6.1.0/implemented/mcp-app-integrations.md](../../../docs/design/v6.1.0/implemented/mcp-app-integrations.md);
  sandbox isolation —
  [docs/design/v6.1.0/implemented/mcp-sandbox-separate-origin.md](../../../docs/design/v6.1.0/implemented/mcp-sandbox-separate-origin.md).
- The four-protocol stack — the `agent-protocols` skill.
