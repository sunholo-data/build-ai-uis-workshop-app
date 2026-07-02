// TEMPLATE — a new MCP App demo, added as a ServerOption.
//
// You usually do NOT write a new page for an MCP App demo. Both
// /dev/mcp-apps/active and /dev/mcp-apps/passive render from the SAME server
// list, so adding one entry to SERVER_OPTIONS in
//   frontend/src/app/dev/mcp-apps/_shared.tsx
// gives you a demo on both pages.
//
// Paste the fixture + option below INTO _shared.tsx (don't create a new file);
// the shapes here match ServerOption / ToolCallState already defined there.

// ── 1. The fixture tool call ──────────────────────────────────────────────
// A ToolCallState the router "replays" so the widget renders. The widget draws
// its own default state from its ui:// resource, so resultContent can be "".
// `name` MUST be a tool your MCP server exposes that binds to a ui:// resource.
const MY_WIDGET_FIXTURE /* : ToolCallState */ = {
  id: "fixture-my-widget-1",
  name: "show-my-widget", // ← the server's tool name (must have a ui:// resource)
  status: "success",
  parentMessageId: "fixture-asst-1",
  argsJson: "{}",
  resultContent: "",
};

// ── 2. The server option ──────────────────────────────────────────────────
// Add this object to the SERVER_OPTIONS array in _shared.tsx.
const MY_SERVER_OPTION /* : ServerOption */ = {
  id: "my-widget", // unique id used by the radio selector
  label: "My widget",
  displayUrl: "http://localhost:3002/mcp", // shown in the UI
  description:
    "One-line description — what the widget shows and which channel(s) it fires.",
  serverId: "my-widget", // used to attribute the tool call to this server

  // How the browser reaches the server:
  //  • CORS-enabled local server → connect directly.
  connect: { kind: "direct", url: "http://localhost:3002/mcp" },
  //  • CORS-blocked remote server → go through the same-origin dev proxy:
  //    connect: { kind: "proxy", target: "my-remote" },
  //    (the proxy route is /dev/mcp-proxy/[target]; "my-remote" is the target)

  toolCall: MY_WIDGET_FIXTURE,

  // Shown while connecting / on failure — tell the user how to start it and why
  // it might be blank. Rendering any iframe also needs the sandbox on :3457.
  runHint: (
    <>
      Start it with <code>make dev-local</code> (or your own server on port
      3002). Rendering the iframe also needs the MCP sandbox on{" "}
      <code>:3457</code>.
    </>
  ),
};

// ── 3. (Optional) a new MCP server ────────────────────────────────────────
// Only if no existing server exposes your widget. Copy
//   infrastructure/mcp-local-demo/   (serve.ts + widget.html)
// as the template: a stateless Streamable-HTTP MCP server that serves ONE tool
// whose result binds a ui:// resource (the widget HTML). Then add its port to
// scripts/dev-local.sh so `make dev-local` starts it.
//
// The widget talks back on two channels (make your demo exercise at least one):
//   • app/notify              → the host adapter turns it into a chat turn
//     (frontend/src/components/protocols/mcpAppNotificationAdapter.ts)
//   • ui/update-model-context → structured on-screen state, no chat turn
//
// NO-KEY baseline: the /dev/mcp-apps/active page's "Synthetic notifications"
// panel fires these payloads through the adapter with no iframe and no server —
// add a matching payload there if your demo teaches the app/notify channel.

export { MY_WIDGET_FIXTURE, MY_SERVER_OPTION };
