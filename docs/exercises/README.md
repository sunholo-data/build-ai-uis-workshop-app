# Round B exercises

Each exercise has the same shape: **the problem → the protocol → try it → the one-liner
you teach back.** You engage the protocol's real payload in a playground, so you *see*
what it does. Run everything on the **`main`** branch.

In the jigsaw, each group goes deep on **one** protocol, then teaches it back.

| Protocol | Doc | Try it | Key? |
|---|---|---|---|
| **AG-UI** | [agui.md](agui.md) | `/dev/a2ui` — click, read the annotated event stream | yes* |
| **A2UI** | [a2ui.md](a2ui.md) | `/dev/a2ui` — edit the JSON, watch it render | **no** ⭐ |
| **MCP Apps** | [mcp.md](mcp.md) | `/dev/mcp-apps/active` — fire a notification, read the log | **no** ⭐ |
| **Setup Guide** (A2UI onboarding) | [setup-guide.md](setup-guide.md) | `/dev/setup-guide` — edit the data model, watch the install command change | **no** ⭐ |

\* AG-UI's live stream runs a real agent turn, so it needs a Gemini key. No key? The doc
has a read-only path that needs neither a key nor a branch.

Everything runs on `main` — no branch switching. Each doc ends with an optional
"go further" step that also stays on `main`.
