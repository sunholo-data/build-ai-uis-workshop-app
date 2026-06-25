# Round B · MCP Apps — wire the second RPC channel

**Goal:** the iframe widget pushes its state via `ui/update-model-context`, but the
host drops it — so the agent stays blind to what's on screen. Forward it to the
backend so it lands in the agent's next-turn context.

**File:** `frontend/src/components/protocols/MCPAppToolCallRouter.tsx` (the
`onFallbackRequest` handler — this is MCP Apps' channel #2 for *live* MCP apps).
**Find:** search for `🧩 WORKSHOP EXERCISE (MCP Apps)`.

**What's going on:** MCP Apps has two iframe→host channels. `ui/message` (synthetic
chat turns) already works. `ui/update-model-context` (structured state) must be
POSTed to `/api/proxy/api/sessions/{sessionId}/iframe-context`, where the backend
merges it into `mcp_app_context.{server}.{tool}` for the next turn. Without the
POST, the agent never learns the widget's state — ask "what city is centred?" and
it can't answer.

**Fix:** restore the `fetchWithAuth(...)` POST of the notification's
`structuredContent` to the iframe-context endpoint (the marker spells out the exact
JSON body: `{ serverId, toolName, structuredContent, content }`).

**Done when:**
```bash
cd frontend && npx vitest run src/components/protocols/__tests__/MCPAppToolCallRouter.iframeContext.test.tsx
```
passes. *(The live map's "answer from context" loop needs cloud mode, but this test
verifies the wiring locally — no key, no cloud.)*

**Reveal the answer:**
```bash
git diff workshop-start main -- frontend/src/components/protocols/MCPAppToolCallRouter.tsx
```
