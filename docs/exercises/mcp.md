# MCP Apps — sandboxed widgets, two channels back

**What it is:** interactive widgets loaded **by reference** and run in a
**separate-origin sandbox**, with two standard channels to talk back to the agent.

## The problem

Drop a raw iframe and wire it yourself.

```tsx
<iframe src={widgetUrl} />
// ❌ same-origin — the widget can read your cookies / auth token
// ❌ no standard way for it to tell the agent what's on screen
// ❌ you hand-roll postMessage glue, differently per widget
```

## The protocol

- **UI by reference:** the tool advertises a `resourceUri`; the host fetches the HTML
  and renders it in a **sandboxed, separate-origin iframe** — it can't read your cookies.
- **Two channels back to the agent:**
  - **`ui/message`** — a synthetic chat turn (*"I clicked Munich"*).
  - **`ui/update-model-context`** — structured state (*"the map is centred on Munich"*)
    merged into the agent's next-turn context, with no chat turn.

## Try it (no key)

1. Open **http://localhost:3456/dev/mcp-apps/active** (and **DevTools → Console** — every
   channel message is narrated there too).
2. Under **Synthetic notifications**, click **fire: location-selected (Munich)**.
3. Watch the **Message log**: the widget's raw `app/notify` is translated by the host
   into a chat message — *"Tell me more about Munich."* That's the `ui/message` channel:
   the widget asking the agent to take a turn. Try **unknown-shape** and **malformed**
   to see the adapter handle bad input.
4. Read **The two iframe→host channels** on the page: `app/notify` → a chat turn, vs
   `ui/update-model-context` → structured on-screen state.
5. **Teachable edit:** open
   `frontend/src/components/protocols/mcpAppNotificationAdapter.ts`, find `locationSelected`,
   and change the string it returns (e.g. `What's the weather in ${location}?`). Save,
   click the **Munich** button again — the host now translates the same notification into
   your new chat message. That's the host-side adapter that turns a widget event into a
   chat turn.

## Going further (needs `make dev-local`, or a key)

- **The second channel, live** — with `make dev-local` up, open **Iframe (real bridge)**,
  pick a server, and drag a **boldkast slider**. The log shows a real
  `ui/update-model-context` frame, sniffed off the wire.
- On this page the chat turn is only logged. Wired into the real chat (with a Gemini key),
  a `ui/message` becomes an actual agent turn.

## The one-liner (your teach-back)

> MCP Apps replaces an insecure raw iframe + bespoke glue with sandboxed widgets and two
> standard channels — so a widget is safe *and* can tell the agent what the user is doing.
