# AG-UI — homespun vs the protocol

**What AG-UI is:** the *transport*. The agent streams a sequence of **typed events**
to the UI (text deltas, tool calls, state, lifecycle), and the frontend is just a
subscriber that maps each event to React state.

## The homespun way (the pain)

Roll your own: one request, wait for the whole reply, dump it at the end.

```ts
// You invent your own wire shape, and the user stares at a spinner until it's ALL done.
const res = await fetch("/chat", { method: "POST", body: JSON.stringify({ message }) });
const text = await res.text();
setMessage(text);
// ❌ no streaming (no token-by-token)
// ❌ tool calls are invisible — they're buried in your bespoke response blob
// ❌ you hand-roll SSE parsing, error handling, reconnection, your own event names
```

Every app reinvents this, differently.

## With AG-UI (the win)

Subscribe to standard typed events; the library owns the stream.

```ts
agent.subscribe({
  onMessagesChanged:    () => sync(),          // streamed text, token by token
  onToolCallStartEvent: (e) => addToolChip(e), // tool calls are first-class events
  onRunError:           (e) => showBanner(e),  // typed errors, not a parse guess
  onRunFinished:        () => setLoading(false),
});
```

16 event types, ~16 callbacks. No custom protocol, no SSE plumbing.

## Try it (read the actual wire — needs the app running + a Gemini key)

1. Open the chat at **http://localhost:3456**, send a message.
2. DevTools → **Network** → the `stream` request → **EventStream/Response**.
3. Watch the order:
   `RUN_STARTED` → many `TEXT_MESSAGE_CONTENT` (deltas) → `TOOL_CALL_START/ARGS/END` →
   `RUN_FINISHED`.
4. Notice: the reply is **built from deltas**, and a tool call is **its own event** —
   the UI on screen is just a projection of this stream.

*(Bonus: `/dev/rich-media` includes an AG-UI protocol-flow diagram.)*

## The point (your teach-back)

> AG-UI replaces a bespoke, per-app streaming hack with a **standard event stream**.
> The UI doesn't parse a blob — it *subscribes* to typed events.

## Going deeper (optional, advanced)

On the `workshop-start` branch, one line of that subscription is blanked
(`onMessagesChanged`). Restore it and prove it:

```bash
git checkout workshop-start
# fix the 🧩 marker in frontend/src/hooks/useSkillAgent.ts, then:
cd frontend && npx vitest run src/hooks/__tests__/useSkillAgent.test.tsx
# reveal: git diff workshop-start main -- frontend/src/hooks/useSkillAgent.ts
```
