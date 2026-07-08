# MCP App Mutation Round-Trip (widget-initiated tool call)

**Status**: Planned
**Priority**: P2 (Low) — teaching/demo feature; high workshop value, not product-blocking
**Estimated**: ~0.5 day
**Scope**: Fullstack (local MCP demo server + widget) + the global `mcp-app-deploy-test` skill scaffold
**Dependencies**: [mcp-app-render-ux.md](../v6.1.0/mcp-app-render-ux.md) (MCP App rendering); the `window.openai`/postMessage dual-bridge already shipped in `infrastructure/mcp-local-demo/`
**Created**: 2026-07-04
**Last Updated**: 2026-07-04

## Problem Statement

Our MCP App demo widget (`infrastructure/mcp-local-demo/widget.html`) only
demonstrates **one-way notify** channels — the widget *tells* the model a value:

- `ui/update-model-context` (SEP-1865 postMessage) — the slider's value.
- `window.openai.setWidgetState` / `sendFollowUpMessage` (ChatGPT/Copilot).

None of these **perform a server-side action and return a result**. They let the
model *learn* something; they don't let the widget *do* something. The MCP Apps
workshop calls out a distinct, more powerful pattern — the **"right way to do
mutations"**: the widget emits an action → the host calls a **tool** on our MCP
server → the server mutates state and **returns a result** that flows back to the
widget *and* the model.

**Current State:**
- The demo teaches "two kinds of tools" implicitly (`Greet` = data tool,
  `show-demo` = UI tool) but never shows a **UI tool's widget calling a data
  tool** — the mutation round-trip.
- Bug: `show-demo` sets `_meta["openai/widgetAccessible"]: true` **on itself**,
  which is meaningless (that flag marks a tool as callable *from* a widget;
  nothing calls `show-demo`). It should sit on an action tool.
- Workshop attendees ask "how do I make the widget *change* something?" and we
  have no reference answer in-repo.

**Impact:**
- Developers/attendees learning MCP Apps — the mutation round-trip is the pattern
  most interactive apps actually need, and it's the one we don't demonstrate.

## Goals

**Primary Goal:** Demonstrate the full **emit → host calls tool → server mutates →
result returns to widget + model** round-trip in the local demo, cross-host
(ChatGPT/Copilot via `window.openai.callTool`; Claude/Inspector via the SEP-1865
tool-call bridge), with a toy server-side counter.

**Success Metrics:**
- In ChatGPT: clicking **+1** increments a **server-held** count and the model
  can state the new value on request (round-trip proven end-to-end).
- Zero regressions: the notify slider and `Greet` still work.
- No `window.openai` errors on non-ChatGPT hosts (guarded + fallback).

**Non-Goals:**
- Any real/persistent data — the counter is in-memory, toy, reset on restart.
- Auth/production exposure (covered by the anonymous dev-tunnel posture).
- Model-*driven* mutation ("the model configures the sim") — that's a separate,
  larger pattern (`ui/notifications/tool-input`); out of scope here.

## Axiom Alignment

Score each axiom per [Product Axioms](../../../docs/product-axioms.md). Net score must be >= +4. Max 2 conflicts (-1) allowed.

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | +1 | Widget renders the server result immediately on click — a tight, deterministic action, faster than round-tripping a full model turn (`sendFollowUpMessage`). |
| 2 | EARNED TRUST | 0 | Toy counter, no factual claims. (The *pattern* is trust-positive — user-initiated, host-approvable, server-authoritative result rather than a model-guessed value — but the demo itself makes no claims.) |
| 3 | SKILLS, NOT FEATURES | 0 | Teaching/infra pattern; MCP tools are the sanctioned developer-extensibility path (Axiom 3 tradeoff), invisible to end users. |
| 4 | RIGHT MODEL, RIGHT MOMENT | 0 | No model routing. (The mutation is a deterministic tool call — zero LLM tokens to perform it — but the feature doesn't change routing.) |
| 5 | GRACEFUL DEGRADATION | +1 | Explicit host fallback: `window.openai.callTool` → SEP-1865 tool-call → and if neither is available the widget still renders and the notify slider still works. |
| 6 | PROTOCOL OVER CUSTOM | +1 | Adopts the standard tool-call-from-widget surface (OpenAI Apps SDK `callTool` / MCP Apps `app.callServerTool`); no custom channel invented. |
| 7 | API FIRST | 0 | One MCP tool, rendered by every host — but this is the local demo, not the platform channel API. |
| 8 | OBSERVABLE BY DEFAULT | +1 | Tool calls are visible server-side (a real `tools/call` in MCP request logs), unlike the fire-and-forget postMessage notify channel the model-context path uses. |
| 9 | SECURE BY CONSTRUCTION | +1 | The sandboxed widget gets **no creds and no direct network** — the mutation is routed through a declared, host-approvable tool. Deny-by-default: the action tool must be *explicitly* marked `widgetAccessible`. Also fixes the misplaced flag. Toy data only. |
| 10 | THIN CLIENT, FAT PROTOCOL | +1 | Mutation logic lives in the **server** tool handler; the widget only calls the tool and renders the returned value. Textbook thin-widget/fat-protocol. |
| | **Net Score** | **+6** | Threshold: >= +4 ✅ |

**Conflict Justifications:**
- None (no axiom scored -1).

## Standards compliance (Axiom #6 check)

No custom format. This adopts the **existing** widget→server tool-call surface of
two standards, which our `resources/host-compliance.md` already maps:

| Host family | API the widget calls | Tool metadata needed |
|---|---|---|
| ChatGPT / Copilot (OpenAI Apps SDK) | `window.openai.callTool(name, args)` → resolves with the tool result | `_meta["openai/widgetAccessible"]: true` on the action tool (Copilot ignores the flag but supports the call via `app.callServerTool`) |
| Claude Desktop / Inspector / MCPJam (SEP-1865) | MCP Apps `app.callServerTool({ name, arguments })` (host proxies a `tools/call`) | `_meta.ui.resourceUri` binding on the UI tool; action tool is a normal tool |

> **Implementation-time verification (mandatory):** confirm the exact SEP-1865
> **wire method** the host expects for a widget-initiated tool call against the
> vendored spec in the `agent-protocols` skill
> (`.claude/skills/agent-protocols/references/mcp-apps-spec-*.md`) before hand-
> rolling it — our widgets currently hand-roll postMessage (no MCP Apps client
> SDK). The `window.openai.callTool` path is verified against the Microsoft Learn
> capability table (see Related Documents). Do not assert a raw `ui/*` method
> name from memory.

## Design

### Overview

Add a **data/action tool** `increment-counter` to the local demo server that
mutates a **module-level** in-memory count and returns the new value. The
`show-demo` **UI tool's** widget gets a **+1** button that calls
`increment-counter` via the host's tool-call bridge (`window.openai.callTool` on
ChatGPT/Copilot; the SEP-1865 `app.callServerTool` path otherwise) and renders the
returned server count. This is the first in-repo demo of the mutation round-trip,
sitting alongside the existing one-way notify slider.

### The two tool kinds (what this demo makes explicit)

| | **Data tool** | **UI tool** |
|---|---|---|
| Returns | data/text to the model | renders a widget |
| Metadata | plain (no `_meta.ui`) | `_meta.ui.resourceUri` + `openai/outputTemplate` |
| Examples | `Greet`, **`increment-counter` (new)** | `show-demo` |
| Role in the round-trip | **the thing the widget calls** | **the thing whose widget calls it** |

### Backend Changes — `infrastructure/mcp-local-demo/serve.ts`

**State (the one real design decision).** The server is stateless *per request*
(a fresh `Server` + transport per POST). A mutable counter must therefore live
**at module scope**, not inside `makeServer()`, so it survives across requests:

```ts
// Module-level singleton — survives the per-request Server instances.
let counter = 0;
```

**New data tool** in `ListToolsRequestSchema` (a *data* tool — no `_meta.ui`),
marked accessible so a widget may call it:

```ts
{
  name: "increment-counter",
  description:
    "Increment the demo counter on the SERVER and return the new value. " +
    "Called by the show-demo widget's +1 button (or directly by the model).",
  inputSchema: { type: "object", properties: {
    by: { type: "number", description: "Amount to add (default 1)." } } },
  // Marks THIS tool as callable from a widget (OpenAI Apps SDK). Copilot ignores
  // the flag but supports the call; SEP-1865 hosts don't need it.
  _meta: { "openai/widgetAccessible": true },
}
```

**Handler** in `CallToolRequestSchema` — mutate + return the new value as both
`content` (model-readable) and `structuredContent` (widget-readable via
`window.openai.toolOutput` / the callTool result):

```ts
if (request.params.name === "increment-counter") {
  const by = Number((request.params.arguments ?? {}).by ?? 1) || 1;
  counter += by;
  return {
    content: [{ type: "text", text: `Counter is now ${counter}.` }],
    structuredContent: { counter },
  };
}
```

**Fix in passing:** remove `"openai/widgetAccessible": true` from the `show-demo`
UI tool's `_meta` (it's meaningless there — nothing calls `show-demo`). The flag
now lives only on `increment-counter`.

### Widget Changes — `infrastructure/mcp-local-demo/widget.html`

Add a **+1** button + a count readout. On click, call the action tool through the
host bridge, mirroring the existing dual-bridge `emit()` pattern:

```js
async function incrementCounter() {
  const oa = (typeof window !== "undefined") ? window.openai : undefined;
  try {
    let result;
    if (oa && oa.callTool) {                        // ChatGPT / Copilot
      result = await oa.callTool("increment-counter", { by: 1 });
    } else if (window.__mcpApp && window.__mcpApp.callServerTool) {
      // SEP-1865 hosts via the MCP Apps client SDK (Claude/Inspector).
      result = await window.__mcpApp.callServerTool({
        name: "increment-counter", arguments: { by: 1 } });
    } else {
      return; // no tool-call bridge on this host — button is a no-op, widget still fine
    }
    const n = result?.structuredContent?.counter;
    if (typeof n === "number") countEl.textContent = String(n);
  } catch (e) { /* host may have denied/approval-gated — best effort */ }
}
```

- Guarded + `try/catch` → a host without a tool-call bridge (or that denies the
  call) leaves the rest of the widget fully working. The `window.__mcpApp` handle
  is a placeholder for whichever MCP Apps client the SEP-1865 path uses — resolve
  it during implementation against the vendored spec (see the verification note).
- The **notify slider stays untouched** — this is additive, a *second* channel
  demonstrating a *different* pattern.

### Skill scaffold — `~/.claude/skills/mcp-app-deploy-test/resources/scaffold/`

Apply the identical change to the scaffold's `serve.ts` + `widget.html`. The
scaffold is the reusable reference; today it shows the notify channels but not the
mutation round-trip — the pattern most interactive apps actually need. Update the
scaffold header comment to note the third channel.

### Optional — `/dev` fixture

A no-key `/dev` fixture can't exercise a live `callTool` (no host bridge), so this
pattern is inherently a *hosted* demo. If a `/dev` note is wanted, add a short
paragraph to the mcp-apps dev page explaining that the mutation round-trip only
lights up inside a real host (ChatGPT/Copilot/Claude/Inspector), pointing at the
tunnel workflow. No new fixture route.

### Architecture Diagram

```
[user clicks +1 in widget]
      │  window.openai.callTool("increment-counter",{by:1})   (ChatGPT/Copilot)
      │  app.callServerTool(...)                              (SEP-1865 hosts)
      ▼
[HOST]  ──(may prompt user to approve)──►  tools/call increment-counter
      ▼
[our MCP server]  counter += by   ──►  { content:"Counter is now N", structuredContent:{counter:N} }
      ▼
[HOST] returns result  ──►  widget renders N   AND   model sees "Counter is now N"
```

## Implementation Plan

### Phase 1: Backend (~0.15 day)
- [ ] `serve.ts`: module-level `counter`, `increment-counter` data tool + handler, remove misplaced `widgetAccessible` from `show-demo` (~25 LOC).
- [ ] Typecheck (`npm run lint`), restart `:3001`, verify with
      `scripts/verify-tunnel.sh <url> increment-counter '{"by":1}'`.

### Phase 2: Widget (~0.15 day)
- [ ] `widget.html`: +1 button, count readout, dual-bridge `callTool` with fallback (~30 LOC).
- [ ] Confirm SEP-1865 tool-call wire against the vendored spec; wire the fallback path.

### Phase 3: Scaffold + docs (~0.15 day)
- [ ] Mirror both edits into the skill scaffold; update its header comment + `resources/host-compliance.md` (add a "widget calls a tool" row).
- [ ] Optional `/dev` note.

## Migration & Rollout

**Data Migrations:** None (in-memory toy state).
**Feature Flags:** None.
**Rollback Plan:** Revert the two files; additive change, no persisted state.
**Environment Variables:** None.

**CLI Surface:** None. This is a teaching fixture in the local demo server, not a
platform resource developers create/list — no `aitana` command warranted.

## Testing Strategy

### Backend
- [ ] `increment-counter` returns an incrementing `structuredContent.counter`
      across successive calls (proves module-level state survives per-request
      `Server` instances) — via `verify-tunnel.sh` (2× call, expect 1 then 2).
- [ ] `show-demo` no longer carries `widgetAccessible`; `increment-counter` does.

### Manual (cross-host)
- [ ] **ChatGPT:** render `show-demo`, click **+1**, ask "what's the counter?" →
      model states the current server value; click again → increments.
- [ ] **Claude Desktop / Inspector:** button increments via the SEP-1865 path (or
      degrades cleanly if that host lacks a widget tool-call bridge).
- [ ] **Regression:** notify slider still pushes context; `Greet` still works.

## Security Considerations

- **Sandbox preserved / no creds in the widget** — the mutation is a declared tool
  the host invokes (and may gate behind user approval), never a direct
  widget→backend call. This is the *reason* the pattern exists (Axiom 9).
- **Deny-by-default** — a widget can only call a tool explicitly marked
  `widgetAccessible`; fixing the misplaced flag tightens this.
- **Toy data only** — in-memory counter, no user/customer data, public teaching
  server. No egress beyond the dev tunnel (already anonymous/dev-only).

## Performance Considerations

- One extra network round-trip per click (widget → host → server → back).
  Negligible; the counter handler is O(1).
- Bundle: widget is inline HTML in the demo server; no frontend bundle impact.

## Success Criteria

- [ ] `increment-counter` mutates server state and returns the new count (2 calls → 1, 2).
- [ ] ChatGPT: **+1** round-trip proven — widget shows the new count AND the model can state it.
- [ ] `show-demo` widgetAccessible flag removed; present on `increment-counter`.
- [ ] No `window.openai` errors on non-ChatGPT hosts; notify slider + `Greet` unregressed.
- [ ] Scaffold + `resources/host-compliance.md` updated; skill still validates and `verify-tunnel.sh` passes.
- [ ] `npm run lint` clean in `infrastructure/mcp-local-demo/`.

## Open Questions

- **SEP-1865 widget→tool-call wire.** Exact method/SDK for a widget-initiated
  `tools/call` on non-ChatGPT hosts — resolve against the vendored MCP Apps spec
  at implementation time (see the verification note). ChatGPT/Copilot path
  (`window.openai.callTool`) is confirmed.
- **Approval UX.** Some hosts gate `callTool` behind a user-approval prompt; note
  this in the widget copy so the demo doesn't look "stuck" awaiting approval.

## Related Documents

- [mcp-app-render-ux.md](../v6.1.0/mcp-app-render-ux.md) — how MCP Apps render in this platform.
- Global skill `mcp-app-deploy-test` — `resources/host-compliance.md` (host × bridge × metadata matrix incl. `callTool` ↔ `app.callServerTool`) and `resources/scaffold/` (the reference server this demo lives in).
- [MCP apps in Microsoft 365 Copilot — Microsoft Learn](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/plugin-mcp-apps) — authoritative `window.openai.callTool` ↔ `app.callServerTool` + `widgetAccessible` support table.
- [OpenAI Apps SDK](https://developers.openai.com/apps-sdk) · [MCP Apps overview](https://modelcontextprotocol.io/extensions/apps/overview).
- `agent-protocols` skill — vendored SEP-1865 spec for the postMessage tool-call wire.
