# <Demo name> — <one-line hook>

<!--
  TEMPLATE for docs/exercises/<your-demo>.md — copy this, fill the angle-bracket
  slots, delete the comments. House shape (see a2ui.md / mcp.md as the models):

      the problem → the protocol → try it (no key) → teachable edit →
      the one-liner you teach back

  Rules that keep it in house style:
   • The "Try it" path MUST be no-key / offline. Name the exact file + symbol.
   • Frontend is on port 3456. Use full URLs: http://localhost:3456/dev/<route>
   • End with a single teach-back sentence.
   • Then add a row to the table in docs/exercises/README.md.
-->

**What it is:** <one sentence — what the attendee sees and why it matters.>

## The problem

<The naive way, and why it hurts. A tiny code block helps.>

```tsx
// ❌ the hardcoded / insecure / bespoke version
```

## The protocol

<How the protocol solves it. For A2UI: show the JSON. For MCP Apps: show the two
channels. Keep it to the essential shape.>

## Try it (no key)

1. Open **http://localhost:3456/dev/<your-route>**.
2. <What to click / observe. Point at the on-page log or the browser console —
   both narrate what's happening.>
3. **Teachable edit:** open `<path/to/the/file>`, find `<SYMBOL>`, change
   `<x>` to `<y>`, save, and watch <what changes>. That's <the concept> in one
   edit.

## The one-liner (your teach-back)

> <One sentence the attendee can say to explain the protocol from memory.>

## Go further (optional, may need a key)

<The live-agent step, clearly marked as optional and needing `make dev-local`
and/or a Gemini key. Never the baseline.>
