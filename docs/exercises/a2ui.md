# Round B · A2UI — render to the workspace surface

**Goal:** the `demo-workspace` skill's dashboard renders inline in the chat bubble
instead of the persistent **workspace pane**. Route it to the workspace surface.

**File:** `backend/db/local_fixture.py` (the `demo-workspace` skill seed)
**Find:** search for `🧩 WORKSHOP EXERCISE (A2UI)` — it's inside the skill's
`toolConfigs.a2ui` dict.

**What's going on:** A2UI routes a skill's UI to a surface via one config key,
`default_surface`. With it unset, output falls back to the chat bubble; set it to
`"workspace"` and the renderer targets the workspace pane (sprint 2.9 surface
routing).

**Fix — one line, inside the `"a2ui": { … }` dict:**
```python
"default_surface": "workspace",
```

**Done when:**
```bash
cd backend && uv run pytest tests/unit/test_demo_workspace_surface.py
```
passes — and live, **"show me the dashboard"** renders in the workspace pane, not
in chat.

**Reveal the answer:**
```bash
git diff workshop-start main -- backend/db/local_fixture.py
```
