# Round B · AG-UI — restore the event stream

**Goal:** the chat is frozen — a streamed reply never appears. Wire the one AG-UI
subscription callback that pushes message updates into React state.

**File:** `frontend/src/hooks/useSkillAgent.ts`
**Find:** search the file for `🧩 WORKSHOP EXERCISE (AG-UI)` — it's inside the
`agent.subscribe({ … })` block.

**What's going on:** `@ag-ui/client`'s `agent.subscribe({...})` maps AG-UI events to
React state. The agent buffers `TEXT_MESSAGE_CONTENT` deltas into `agent.messages`
and fires a callback whenever they change. Without that callback wired,
`agent.messages` updates but the UI never re-reads them — so nothing streams.

**Fix — one line, in the subscribe block:**
```ts
onMessagesChanged: () => sync(),
```
(The other callbacks beside it — `onRunStartedEvent`, `onToolCallStartEvent`, … —
show the `eventName: () => { … }` shape.)

**Done when:**
```bash
cd frontend && npx vitest run src/hooks/__tests__/useSkillAgent.test.tsx
```
passes — and live, a chat reply streams in token-by-token.

**Reveal the answer:**
```bash
git diff workshop-start main -- frontend/src/hooks/useSkillAgent.ts
```
