# Demo reliability fixes (day-before-workshop pass)

Field notes from verifying every LOCAL_MODE demo end-to-end against a real
Gemini key, the day before the "Build AI UIs Beyond Chat" workshop. Seven bugs,
all **inherited from the template, not introduced by this fork**.

## Provenance — these are upstream bugs

Every affected file traces to the single template-import commit
`2844e51 "Refresh public template from Aitana-Labs/platform 3cb4339"`. The fork
only added blanked exercises + `/dev/*` playgrounds; the buggy protocol code is
verbatim from upstream. The **platform source of truth still has them** (checked
`Aitana-Labs/platform` @ `9a0c7e1`, branch `dev`): `A2UIRenderer.tsx:109` still
has the loop-causing `}, [processor, onAction]);`, and `useSkillAgent.ts` has
**0** references to `onRunErrorEvent`.

So the same bugs live in the public template `ai-protocol-platform` and
everything forked from it. **These should go upstream** (fix in
`Aitana-Labs/platform` → `scripts/refresh-public-template.sh` → propagates).

Fixed here in: `b72e40a`, `acc03ca`. Regression guard: `5a6443f` (`make preflight`).

## Summary

| # | Bug | Severity | Fix commit | Upstream |
|---|-----|----------|-----------|----------|
| 1 | RUN_ERROR silently eaten → "thinking… then blank" | 🔴 high | b72e40a | yes |
| 2 | Form-submit fires an **unbounded agent-turn loop** (millions of tokens) | 🔴 critical | acc03ca | yes |
| 3 | A2UI `createSurface` throws "Surface already exists" on turn 2 | 🔴 high | b72e40a | yes |
| 4 | `surface-action-run` 404 after backend restart (ephemeral session) | 🟠 med | b72e40a | yes |
| 5 | Click-spam: each click = a full agent turn, no debounce | 🟠 med | b72e40a | yes |
| 6 | LOCAL_MODE model default `gemini-2.5-pro` is `limit:0` (dead on free tier) | 🟠 med | b72e40a | yes + docs |
| 7 | `/dev/a2ui` fixture uses wrong v0.9 message shape (never rendered) | 🟡 low | b72e40a | if playground is upstream |

---

## 1. RUN_ERROR events silently eaten

**Symptom:** any backend error (Gemini 429, tool failure, bad model) shows the
typing indicator, then the reply area goes blank. No banner, no console error.
Every failure looks like "the demo is broken."

**Root cause:** `useSkillAgent` subscribed to `onRunFailed`, but the
`@ag-ui/client` (0.0.52) dispatches a stream `RUN_ERROR` **event** to
`onRunErrorEvent` — `onRunFailed` only fires on a pipeline-level throw. The
RUN_ERROR case completes the stream cleanly (never throws), and the backend's
terminal-dedup drops the trailing `RUN_FINISHED`, so nothing fired and
`runAgent` resolved normally. The error vanished.

**Fix:** subscribe to `onRunErrorEvent` (classify off the event's `message`/
`code`); classify 429/`RESOURCE_EXHAUSTED` as a distinct `rate_limited` kind
(amber banner: "key/quota, not a broken demo"); `onRunFailed` now classifies off
`{error}` for genuine pipeline throws. `frontend/src/hooks/useSkillAgent.ts`,
`ChatShell.tsx` (banner).

## 2. Form-submit action loop (critical — burns tokens)

**Symptom:** filling and submitting the Form Builder demo spams
`[a2ui:submit_registration]` messages and hammers the Gemini API — one submit
spun hundreds of agent turns / millions of tokens in ~1 minute.

**Root cause:** `A2UIRenderer` re-subscribed to `model.onAction` (deps
`[processor, onAction]`, and `onAction` is a fresh closure each render) **and**
re-ran `processMessages` on every render (parent re-parses → new `messages`
identity). Re-processing rebuilt the component tree → the submit Button
re-mounted → re-dispatched its action. `ChatShell.handleAction` (the choke point
for every A2UI action → `sendMessage`) had **no in-flight gate**, unlike
`handleSend`. Exposed once fix #3 made re-processing succeed instead of throwing.

**Fix (three layers):** `A2UIRenderer` subscribes **once per processor** (latest
`onAction` via ref) and **processes each payload once** (skip unchanged content);
`ChatShell.handleAction` drops an action while a run is in flight and dedupes an
identical action within 8s. `A2UIRenderer.tsx`, `ChatShell.tsx`.

**Verified:** one submit click → exactly one agent turn (was unbounded).

## 3. A2UI "Surface already exists"

**Symptom:** A2UI demos render on turn 1, then on turn 2 show a raw-JSON error
bubble `Surface X already exists` (form-builder) or a console error and a frozen
surface (click-counter).

**Root cause:** agents re-emit a full A2UI batch (incl. `createSurface`) each
turn, and the click-counter fixture seeds the surface — so a second
`createSurface` hits web_core's "already exists" throw, and the whole batch was
dropped. Two independent render paths had it: the named-surface path
(`SurfaceRegistry`) and the inline chat path (`A2UIRenderer`).

**Fix:** in v0.9 `createSurface` only declares `surfaceId`/`catalogId`/`theme`
(components + data arrive via `updateComponents`/`updateDataModel`), so for an
existing surface it's redundant — strip it and apply the rest. Applied in **both**
`SurfaceRegistry.tsx` and `A2UIRenderer.tsx`.

## 4. surface-action-run 404 (ephemeral session)

**Symptom:** clicking an action-driven surface returns 404 `Session not found`
after the backend restarts (LOCAL_MODE sessions are in-memory).

**Root cause:** the page bootstraps the session once on mount; a backend restart
wipes it, and the open page never re-bootstraps. The 404 is the index gate
(`_require_session`), not the ADK-session gate.

**Fix:** frontend self-heals — on a 404, bootstrap the session and retry once
(`useActionDrivenAgent.ts`); backend auto-creates the ADK session if missing
instead of 404 (`a2ui_surface_action_run_routes.py`). Access gate stays intact.

## 5. Click-spam (no debounce)

**Symptom:** rapid clicks on an action-driven surface fire N concurrent agent
turns (racing surface updates + rate-limit pressure).

**Fix:** in-flight guard in `A2UISurfaceMount.tsx` drops clicks while a run is in
flight. (Named-surface path; the inline path is covered by fix #2.)

## 6. LOCAL_MODE model default is dead on free tier

**Symptom:** out of the box, the template's demos 429 immediately.

**Root cause:** `local_fixture.py` seeded `gemini-2.5-pro`, which is `limit:0`
(unavailable) on the free tier; and even `gemini-3.5-flash` free tier is
~20 req/day — far too low for a workshop.

**Fix:** switch fixture models to `gemini-3.5-flash` (`local_fixture.py`) **and
document that the demos need a billing-enabled key.** The free tier cannot carry
a room of attendees.

## 7. /dev/a2ui fixture used wrong v0.9 shape

**Symptom:** the A2UI playground rendered `[Loading root…]` forever.

**Root cause:** the seed put components inline in `createSurface` and used
`{data}` in `updateDataModel`. v0.9 wants `createSurface` = `surfaceId`+
`catalogId` only, components via `updateComponents`, and `updateDataModel` =
`{path, value}`.

**Fix:** corrected seed + bootstrap-on-mount (`frontend/src/app/dev/a2ui/page.tsx`).

---

## Why unit tests didn't catch these

They're **integration + environment** failures, and the suite is unit-level with
mocks that share the code's wrong assumptions:

- #1 — tests fire `onRunFailed` on a mock agent, asserting the same wrong premise
  the bug has. Only a real `RUN_ERROR` through the real client exposes it.
- #2, #3 — tests cover a single `createSurface`/turn-1; nobody tested a second
  `createSurface` or the re-render churn on a multi-turn form.
- #4 — tests use fresh state; none simulate a backend restart mid-session.
- #6 — mocked LLMs never hit real quota.

Green CI meant "pieces work in isolation," never "a human clicking through the
real app on a real key works."

**Guard:** `make preflight` (`5a6443f`) — after `make dev-local`, streams every
demo (flags `RESOURCE_EXHAUSTED` as key/quota, not code) and drives a real
browser through the A2UI paths incl. a **form-submit loop regression check**.
Run it the morning of.

## Upstream plan

1. Port fixes #1–#6 into `Aitana-Labs/platform` (identical files — edits apply
   cleanly). #7 only if the `/dev/a2ui` playground ships in the template.
2. `scripts/refresh-public-template.sh` → publishes to `ai-protocol-platform`.
3. Add the "needs a paid Gemini key" note to the template README / WORKSHOP.md.

## Open items

- **workshop-helper** — a slow multi-tool RAG agent; sometimes 18+ tool calls
  and >40s. Finishes, but worth a look (tool-call cap / timeout / prompt).
- **Model choice** — evaluating a lighter/faster model than `gemini-3.5-flash`
  for the demos (latency + cost). TBD which we have access to.
