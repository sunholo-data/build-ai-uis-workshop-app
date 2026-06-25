# Round B exercises — reconstruct one protocol

In Round B (the jigsaw) each group restores **one** deleted piece of the protocol
stack, then proves it with a test.

- You are on the **`workshop-start`** branch — three spots are blanked, each marked
  with a `🧩 WORKSHOP EXERCISE` comment.
- The **`main`** branch has the complete, working code (the solutions).
- Stuck? Reveal the answer for your file:
  ```bash
  git diff workshop-start main -- <the file>
  ```

| Exercise | Protocol | Doc | Success check (no API key needed) |
|---|---|---|---|
| **B1** | AG-UI | [agui.md](agui.md) | `cd frontend && npx vitest run src/hooks/__tests__/useSkillAgent.test.tsx` |
| **B2** | A2UI | [a2ui.md](a2ui.md) | `cd backend && uv run pytest tests/unit/test_demo_workspace_surface.py` |
| **B3** | MCP Apps | [mcp.md](mcp.md) | `cd frontend && npx vitest run src/components/protocols/__tests__/MCPAppToolCallRouter.iframeContext.test.tsx` |

Each blank is a single line / small block in a real platform file — the marker
comment tells you exactly what to restore. AI coding + the helper agent are fair
game.
