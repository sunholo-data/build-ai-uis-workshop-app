# A2UI — homespun vs the protocol

**What A2UI is:** the agent describes UI as **JSON** (a component tree), and one
generic renderer draws it. UI becomes *data the agent emits* — not code you ship.

## The homespun way (the pain)

A hardcoded React component per UI.

```tsx
function ContactForm() {
  return (
    <form>
      <label>Name <input name="name" /></label>
      <label>Email <input name="email" /></label>
      <button>Send</button>
    </form>
  );
}
// ❌ Want a different form? Edit React + rebuild + redeploy.
// ❌ Want the AGENT to decide the form at runtime? You can't — it's compiled in.
```

Every new UI the agent might need = new frontend code + a deploy.

## With A2UI (the win)

The same form is just data — a component tree the agent emits:

```jsonc
{ "version": "v0.9",
  "createSurface": {
    "surfaceId": "demo", "root": "root",
    "catalogId": "https://a2ui.org/specification/v0_9/basic_catalog.json",
    "components": [
      { "id": "root",  "component": "Column", "children": ["title","name","email","send"] },
      { "id": "title", "component": "Text", "text": "Contact", "variant": "h2" },
      { "id": "name",  "component": "TextField", "label": "Name" },
      { "id": "email", "component": "TextField", "label": "Email" },
      { "id": "send",  "component": "Button", "label": "Send" }
    ] } }
```

The renderer draws *any* such tree. New UI = new JSON. Zero React.

## Try it (key-free playground — no agent needed) ⭐

1. Run the app, open **http://localhost:3456/dev/a2ui** — it renders hand-crafted
   A2UI payloads with **no agent run and no API key**.
2. Open `frontend/src/app/dev/a2ui/page.tsx`, find **`PATTERN1_SEED_MESSAGES`**
   (the A2UI JSON) and edit it:
   - add a `Text` component to the `children` + components list,
   - change a `text` value, or bind one to data with `{ "path": "/something" }` and
     add that key to the `updateDataModel` message.
3. Save — Next hot-reloads — watch the surface re-render. **You wrote zero React.**

## The point (your teach-back)

> A2UI turns UI into **declarative data the agent produces**. One generic renderer
> draws anything, so a new interface is *new JSON*, not new frontend code + a deploy.

## Going deeper (optional, advanced)

On `workshop-start`, the `demo-workspace` skill's surface routing is blanked.
Restore it and prove it:

```bash
git checkout workshop-start
# fix the 🧩 marker in backend/db/local_fixture.py (default_surface), then:
cd backend && uv run pytest tests/unit/test_demo_workspace_surface.py
# reveal: git diff workshop-start main -- backend/db/local_fixture.py
```
