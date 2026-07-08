# Sprint Plan — MCP-MUT: MCP App mutation round-trip

**Design doc:** [mcp-app-mutation-round-trip.md](mcp-app-mutation-round-trip.md)
**Sprint ID:** MCP-MUT
**Duration:** ~0.5 day (single session)
**Scope:** Fullstack (local MCP demo server + widget) + global skill scaffold
**Created:** 2026-07-04

## Goal

Demonstrate the MCP Apps **mutation round-trip** — the widget calls a server
tool, the server mutates state and returns a result that lands back in the widget
*and* the model — via a toy `increment-counter`, cross-host, without regressing
the existing notify slider or `Greet`.

## Why no velocity ceremony

Fixed, tiny scope (~55 LOC, 3 files, 1 session). Velocity isn't the constraint;
correctness of the round-trip + cross-host guards is. Plan is proportionate.

## Milestones

### M1 — Backend: the action tool + server state (~25 LOC) — `backend`
`infrastructure/mcp-local-demo/serve.ts`:
- Add module-level `let counter = 0;` (OUTSIDE `makeServer()` — server is
  stateless per request, so a per-request field would reset every call).
- Add `increment-counter` **data tool** to `ListTools` (inputSchema `{by?:number}`,
  `_meta: { "openai/widgetAccessible": true }`, no `_meta.ui`).
- Add its `CallTool` branch: `counter += by; return { content:[…], structuredContent:{ counter } }`.
- **Remove** `"openai/widgetAccessible": true` from the `show-demo` tool `_meta`.

**Acceptance (M1):**
- `npm run lint` clean.
- Restart `:3001`; `verify-tunnel.sh <url> increment-counter '{"by":1}'` twice →
  `counter` is `1` then `2` (proves module-level state survives per-request `Server`s).
- `tools/list` shows `increment-counter`; `show-demo` no longer carries `widgetAccessible`.

### M2 — Widget: the +1 button + dual-bridge callTool (~30 LOC) — `frontend`
`infrastructure/mcp-local-demo/widget.html`:
- Add a **+1** button + a count readout.
- `incrementCounter()`: **feature-detect** the host tool-call API at call time —
  try `window.openai.callTool("increment-counter",{by:1})`, then a `window.openai.mcp.*`
  namespace (workshop hint), then a SEP-1865 `app.callServerTool` handle if present,
  else clean no-op. Guard + `try/catch`. Render `result.structuredContent.counter`.
- Additive only — the notify slider + init handshake stay untouched.

**Acceptance (M2):**
- No `window.openai` reference throws when the object is absent (guarded).
- Widget still renders; slider still emits `ui/update-model-context`.

### M3 — Mirror to the skill scaffold + docs (~15 LOC) — `docs/infra`
- Apply the same `serve.ts` + `widget.html` edits to
  `~/.claude/skills/mcp-app-deploy-test/resources/scaffold/`.
- Add a "widget calls a tool (mutation round-trip)" row to that skill's
  `resources/host-compliance.md` (`callTool` ↔ `app.callServerTool`).
- Update the scaffold header comment to mention the third (mutation) channel.

**Acceptance (M3):**
- `validate_skill.sh mcp-app-deploy-test` passes.
- Scaffold boots in a temp copy; `verify-tunnel.sh … increment-counter` works there too.

## Definition of done (sprint)

- [ ] M1 + M2 + M3 acceptance all green.
- [ ] `npm run lint` clean in `infrastructure/mcp-local-demo/`.
- [ ] Regression: notify slider + `Greet` still work.
- [ ] Live check (manual, host): after a ChatGPT connector refresh, **+1**
      increments and the model can state the current count.
- [ ] SEP-1865 path either verified against the vendored spec OR shipped as a
      clean guarded no-op with a `TODO` + doc note (do not block on it).

## Risks / knowns

- **State placement** — the one correctness trap; M1 acceptance (1→2) is the guard.
- **Widget tool-call API uncertainty** — `callTool` confirmed; `window.openai.mcp.*`
  is a workshop hint. Feature-detect, don't hardcode. Ship ChatGPT path even if
  SEP-1865 stays a no-op.
- **Connector cache** — new tool won't appear in ChatGPT until the connector is
  refreshed; that's expected, not a bug.
