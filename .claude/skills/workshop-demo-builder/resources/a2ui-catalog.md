# A2UI v0.9 `basicCatalog` — verified component reference

The definitive list of components you can use in an A2UI demo, so you never have
to grep `node_modules` or guess whether a component exists. **Verified against
`frontend/node_modules/@a2ui/react/v0_9/index.js`** (the `basicComponents` array,
~line 711 — the exact set registered in `basicCatalog`). If in doubt, re-read
that file; it is the source of truth.

> **Common trap this reference exists to kill:** the catalog is *not* just
> Column/Row/Text/TextField/Button/Divider. It has real **ChoicePicker**
> (dropdown / radio / multi-select), **CheckBox**, **Slider**, and
> **DateTimeInput**. A request for "choices", "a dropdown", "pick one", "options",
> or "a rating" → use **ChoicePicker / Slider / CheckBox**, *not* guided
> TextFields. Don't tell the user the catalog can't express choices — it can.

## All 18 registered components

Every component is a flat node: `{ id, component: "<Name>", ...props }`.
Containers reference children **by id**. `catalogId` for the surface is
`https://a2ui.org/specification/v0_9/basic_catalog.json` (= `basicCatalog.id`).

### Layout & containers

| Component | Key props | Renders |
|---|---|---|
| `Column` | `children: [ids]`, `justify?`, `align?` | vertical flex `<div>`. **The root node is a `Column` with `id: "root"`.** |
| `Row` | `children: [ids]`, `justify?`, `align?` | horizontal flex `<div>` |
| `List` | `children: [ids]`, `direction?: "horizontal"\|"vertical"`, `align?` | scrollable list |
| `Card` | `child: id` (single) | elevated container (shadow) |
| `Tabs` | `tabs: [{ title, child }]` | tab bar + active child |
| `Modal` | `trigger: id`, `content: id` | click trigger → overlay content |
| `Divider` | `axis?: "horizontal"\|"vertical"` | a rule |

### Text & media

| Component | Key props | Notes |
|---|---|---|
| `Text` | `text: string \| {path}`, `variant?` | variants: **`h1`–`h5`**, **`body`** (default, `<span>`). ⚠️ **`caption` renders a literal `<caption>` element → hydration error inside a `<div>`. Never use it.** |
| `Image` | `url: string\|{path}`, `altText?`, `fit?`, `variant?` | variants: `icon`, `avatar`, `smallFeature`, `largeFeature`, `header` |
| `Icon`, `Video`, `AudioPlayer` | (see source) | exist but rarely needed for form/UI demos |

### Inputs — bind each to the data model with `value: { path: "/field" }`

| Component | Key props | Use for |
|---|---|---|
| `TextField` | `value: {path}`, `label?`, `variant?` | free text. variants: default (text), **`longText`** (textarea), **`number`**, **`obscured`** (password) |
| `CheckBox` | `value: {path}` (boolean), `label?` | a single yes/no toggle |
| **`ChoicePicker`** | `options: [{ label, value }]`, `value: {path}` (**array**), `variant?`, `displayStyle?`, `filterable?`, `label?` | **pick from options.** `variant: "mutuallyExclusive"` → single-select (radios); default → multi-select (checkboxes). `displayStyle: "chips"` → chip buttons; default → list. `filterable: true` → adds a filter box. |
| `Slider` | `value: {path}` (number), `min?`, `max`, `label?` | a numeric range (budget, rating, count) |
| `DateTimeInput` | `value: {path}`, `enableDate?`, `enableTime?`, `min?`, `max?`, `label?` | date / time / datetime. both flags → `datetime-local`; date only → `date`; time only → `time` |

### Action

| Component | Key props | Notes |
|---|---|---|
| `Button` | `child: id` (a Text component for the label — **not** a `label` string), `action: { event: { name, context } }`, `variant?`, `isValid?` | variants: `primary`, `borderless`, default. `isValid: false` disables it. `action.event.context` can bind field values by path. |

## "The form needs choices / a dropdown / radio" — use ChoicePicker

The single most common request, answered correctly:

```jsonc
// Single-choice (radio): travel style
{ "id": "style", "component": "ChoicePicker",
  "label": "Travel style",
  "variant": "mutuallyExclusive",
  "displayStyle": "chips",
  "options": [
    { "label": "Relaxation", "value": "relaxation" },
    { "label": "Adventure",  "value": "adventure" },
    { "label": "Culture",    "value": "culture" },
    { "label": "Family",     "value": "family" }
  ],
  "value": { "path": "/style" } }
// value is ALWAYS an array — single-select just holds one element, e.g. ["relaxation"].
```

- **Multi-select** (interests, amenities): same, drop `variant` (defaults to checkboxes).
- **Yes/no** (add insurance?): `CheckBox`.
- **A number** (budget, nights, party size): `Slider` (bounded) or `TextField` `variant: "number"`.
- **A date** (departure): `DateTimeInput`.
- Only fall back to a **guided TextField** (options listed in the `label`) when the
  set of choices is genuinely open-ended or unknown.

## Data binding & the three seed messages (recap)

- Bindable props (`text`, `value`, `url`) take `{ path: "/foo" }` to read from the
  data model; `updateDataModel` supplies the values.
- `createSurface` = **only** `surfaceId` + `catalogId` (components dropped if put here).
- `updateComponents` = the flat component array; root id `"root"`.
- `updateDataModel` = `{ surfaceId, path: "/", value: { ... } }` (not `{ data }`).
  Every bound path needs a value — use `""` / `[]` / `0` for empty.

## Gotchas (fast recap)

- `Text` `variant: "caption"` → illegal `<caption>` element → hydration error. Use `body`.
- `Button` uses `child` (a component id) + `action`, **not** `label`.
- `ChoicePicker` `value` is an **array**, even for single-select.
- `createSurface` carries no components; `updateDataModel` uses `value`, not `data`.
- Unknown component name or prop → renders nothing (silent). This list is the allowed set.
