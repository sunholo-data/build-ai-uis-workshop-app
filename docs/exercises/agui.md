# AG-UI — the agent's event stream

**What it is:** the transport. The agent streams **typed events** — text deltas, tool
calls, lifecycle — and the UI just subscribes. Each event maps to React state.

## The problem

Roll your own: one request, wait for the whole reply, dump it.

```ts
const res = await fetch("/chat", { method: "POST", body: JSON.stringify({ message }) });
setMessage(await res.text());
// ❌ no streaming — the user watches a spinner
// ❌ tool calls are invisible, buried in your response blob
// ❌ you hand-roll SSE parsing, errors, reconnection
```

Every app reinvents this, differently.

## The protocol

Subscribe to standard typed events; the library owns the stream.

```ts
agent.subscribe({
  onMessagesChanged:    () => sync(),           // streamed text
  onToolCallStartEvent: (e) => addToolChip(e),  // tool calls are real events
  onRunErrorEvent:      (e) => showBanner(e),   // typed errors
  onRunFinalized:       () => setLoading(false),
});
```

## Try it

**See it live** — needs the app running with a Gemini key:

1. Open **http://localhost:3456/dev/a2ui** and click the **Click me** button.
2. Read the **Wire log** below. Events fire in order:
   `RUN_STARTED` → `TEXT_MESSAGE_CONTENT` (deltas) → `TOOL_CALL_START / ARGS / END` →
   `RUN_FINISHED`. Each row says *why* it fired — click one for the raw JSON.
3. The reply is built from deltas; a tool call is its own event. The UI is just a
   projection of this stream.

**No key? Read the wiring** — no key, no branch:

- Open `frontend/src/hooks/useSkillAgent.ts` and find `agent.subscribe({ … })`. Each
  callback maps one AG-UI event to state — that's the whole integration.
- `/dev/rich-media` has an AG-UI protocol-flow diagram.

## The one-liner (your teach-back)

> AG-UI replaces a bespoke, per-app streaming hack with one standard typed event
> stream. The UI subscribes to typed events — it doesn't parse a blob.
