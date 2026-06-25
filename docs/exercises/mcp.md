# MCP Apps — homespun vs the protocol

**What MCP Apps is:** **sandboxed interactive widgets** with two *standard* channels
back to the agent. UI is loaded **by reference** (the tool declares a `resourceUri`;
the host fetches the HTML and renders it in a separate-origin sandbox), and the
widget can talk back.

## The homespun way (the pain)

Drop a raw iframe and wire it yourself.

```tsx
<iframe src={widgetUrl} />
// ❌ same-origin → the widget can read your cookies / Firebase token
// ❌ no standard way for the widget to tell the agent what's on screen
// ❌ you hand-roll postMessage glue, ad-hoc, differently per widget
```

## With MCP Apps (the win)

- **UI by reference:** `tools/list` advertises `_meta.ui.resourceUri`; `tools/call`
  returns *data only*; the host fetches the HTML and renders it in a **sandboxed,
  separate-origin iframe** (dev: port 3457) — it can't read your cookies.
- **Two channels back to the agent:**
  - `ui/message` — a synthetic chat turn ("I clicked Munich").
  - `ui/update-model-context` — structured state ("centre = Munich") merged into the
    agent's **next-turn context**, so it can answer "what's on screen?" without
    re-rendering.

## Try it (key-free playground — no iframe/agent needed) ⭐

1. Run the app, open **http://localhost:3456/dev/mcp-apps/active**.
2. It mounts the real router with a button panel that **synthesizes iframe
   notifications**. Click to fire a **`ui/message`** and a
   **`ui/update-model-context`** and watch them route through the bridge in the
   on-page log — the two channels, exercised without a live iframe or a key.
3. *(With `make dev-local` up so the sandbox is running, `/dev/mcp-apps/passive`
   shows the **UI-by-reference** render — the host fetching + sandboxing the widget
   HTML.)*

## The point (your teach-back)

> MCP Apps replaces an **insecure raw iframe + bespoke glue** with **sandboxed
> widgets and two standard channels** — so a widget is safe *and* can feed the
> agent what the user is doing.

## Going deeper (optional, advanced)

On `workshop-start`, the `ui/update-model-context` forwarding is blanked (the agent
goes blind to the widget). Restore it and prove it:

```bash
git checkout workshop-start
# fix the 🧩 marker in frontend/src/components/protocols/MCPAppToolCallRouter.tsx, then:
cd frontend && npx vitest run src/components/protocols/__tests__/MCPAppToolCallRouter.iframeContext.test.tsx
# reveal: git diff workshop-start main -- frontend/src/components/protocols/MCPAppToolCallRouter.tsx
```
