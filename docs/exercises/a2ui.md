# A2UI — UI as JSON

**What it is:** the agent describes UI as **JSON** (a component tree) and one generic
renderer draws it. UI is data the agent emits, not code you ship.

## The problem

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
// ❌ A different form means editing React + a redeploy.
// ❌ The agent can't decide the UI at runtime — it's compiled in.
```

## The protocol

The same form is a component tree the agent emits:

```jsonc
"components": [
  { "id": "root",  "component": "Column", "children": ["title", "name", "email", "send"] },
  { "id": "title", "component": "Text", "text": "Contact", "variant": "h2" },
  { "id": "name",  "component": "TextField", "label": "Name" },
  { "id": "email", "component": "TextField", "label": "Email" },
  { "id": "send",  "component": "Button", "label": "Send" }
]
```

One renderer draws any such tree. New UI = new JSON, zero React.

## Try it (no key)

The playground renders one small A2UI program — a **click counter** — from JSON. You
edit the JSON and watch it change. No agent, no key.

1. Open **http://localhost:3456/dev/a2ui**. You'll see a "Click Counter" surface.
2. Open `frontend/src/app/dev/a2ui/page.tsx` and find **`PATTERN1_SEED_MESSAGES`**. The
   component tree lives in the **`updateComponents`** message (not `createSurface`).
3. Make one edit inside `updateComponents.components`, save, and watch it hot-reload:

   **Change a label:**
   ```ts
   { id: "title", component: "Text", text: "My first A2UI surface", variant: "h2" },
   ```

   **Add a line of UI** (two edits):
   ```ts
   // 1. add "subtitle" to the root Column's children:
   { id: "root", component: "Column", children: ["title", "subtitle", "display", "btn"] },
   // 2. add the component itself:
   { id: "subtitle", component: "Text", text: "Rendered from JSON — zero React" },
   ```

4. Save — the surface re-renders. You wrote zero React.

## The one-liner (your teach-back)

> A2UI turns UI into declarative data the agent produces. One renderer draws anything,
> so a new interface is new JSON — not new frontend code and a deploy.

## Go further (optional): data binding

The counter line is already data-bound — use it as the template. Two pieces, in two of
the seed messages:

```ts
// in updateComponents — the Text reads from a path, not a literal string:
{ id: "display", component: "Text", text: { path: "/counterDisplay" } },

// in the updateDataModel message — the value at that path:
value: { counter: 0, counterDisplay: "Clicks: 0" },
```

`/counterDisplay` is just the `counterDisplay` key in that `value` object. To "edit" it,
change the string there and save — the bound Text re-renders. Bind your own the same way:
add `heading: "Hi"` to `value`, then point a component at it with `text: { path: "/heading" }`.

At runtime the agent edits the value, not the markup — each counter click sends a fresh
`updateDataModel` with a new `counterDisplay`, and the bound Text updates without any
components being re-sent. That's the point of binding.
