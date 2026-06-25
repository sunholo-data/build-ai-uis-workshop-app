# Round B exercises — what each protocol actually does

Each exercise follows the same shape: **the homespun way (the pain) → the protocol
(play with it) → what the protocol removed.** You mostly engage the protocol's real
*payload* in a playground — no agent, no API key — so you *see* what it does.

Run these on the **`main`** branch (the working app). In the jigsaw, each group goes
deep on **one** protocol, then teaches it back.

| Protocol | Doc | Play with it | API key? |
|---|---|---|---|
| **AG-UI** | [agui.md](agui.md) | the live SSE event stream in DevTools (+ `/dev/rich-media`) | yes (live reply) |
| **A2UI** | [a2ui.md](a2ui.md) | **`/dev/a2ui`** — edit the A2UI JSON, watch it render | **no** ⭐ |
| **MCP Apps** | [mcp.md](mcp.md) | **`/dev/mcp-apps/active`** — fire the two channels, watch the bridge | **no** ⭐ |

## Optional advanced tier — "see where the platform wires it"

For the keen: the **`workshop-start`** branch blanks the one real line/block that
makes each protocol work, marked with a `🧩 WORKSHOP EXERCISE` comment. Restore it
until the matching test passes:

```bash
git checkout workshop-start          # three blanks; each marker points to its doc
# AG-UI:    cd frontend && npx vitest run src/hooks/__tests__/useSkillAgent.test.tsx
# A2UI:     cd backend  && uv run pytest tests/unit/test_demo_workspace_surface.py
# MCP Apps: cd frontend && npx vitest run src/components/protocols/__tests__/MCPAppToolCallRouter.iframeContext.test.tsx
git diff workshop-start main -- <file>   # reveal the answer
```
