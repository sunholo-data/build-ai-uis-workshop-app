// mcp-local-demo — a tiny, self-contained MCP App server for the workshop.
//
// Why this exists: attendees kept needing "yet another download" (cloning
// modelcontextprotocol/ext-apps and running its map-server) to get a LOCAL
// MCP App with a real widget. This server ships in the repo and is started by
// `make dev-local` on :3001 — no external clone. It serves one tool
// (`show-demo`) bound to a ui:// resource (widget.html) that exercises BOTH
// iframe→host channels, so /dev/mcp-apps/active works fully offline.
//
// Streamable HTTP, stateless (a fresh Server+transport per request — no
// session store needed for a single-tool demo). CORS is open so the browser
// MCP client at :3456 can connect directly (same reason the ext-apps
// map-server is CORS-enabled). Dev-only — not a deployed service, but it can
// be exposed to ChatGPT dev mode over a cloudflared quick tunnel:
//   cloudflared tunnel --url http://localhost:3001
// then add <tunnel-url>/mcp as an MCP connector. The tool carries BOTH UI
// bindings — MCP Apps (_meta.ui.resourceUri) + OpenAI Apps SDK
// (_meta["openai/outputTemplate"]) — so the same widget renders in this app
// AND in ChatGPT. widget.html detects the host and picks the right bridge.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.MCP_LOCAL_DEMO_PORT || 3001);
const TOOL_NAME = "show-demo";
const GREET_TOOL = "Greet";
const RESOURCE_URI = "ui://local-demo/widget/v1";
// Read per-request (not cached at boot) so editing widget.html is live in dev
// without restarting this server.
const WIDGET_PATH = join(__dirname, "widget.html");
const readWidgetHtml = (): string => readFileSync(WIDGET_PATH, "utf8");

// Empty domain lists — the widget is self-contained (inline script/style, no
// network). The sandbox always allows inline script/style regardless (see
// infrastructure/mcp-sandbox/src/serve.ts buildCspHeader), so this is enough.
const CSP = { resourceDomains: [], connectDomains: [], frameDomains: [] };
// Same intent, ChatGPT's snake_case shape (_meta["openai/widgetCSP"]).
const OPENAI_CSP = { connect_domains: [], resource_domains: [] };
const WIDGET_DESCRIPTION =
  "A tiny projectile-angle widget that reports back to the host.";
const COUNTER_TOOL = "increment-counter";

// Module-level singleton — SURVIVES the per-request Server instances. makeServer()
// runs fresh for every POST (stateless transport), so counter state kept inside it
// would reset on each call; the mutation-round-trip demo needs it to persist.
let counter = 0;

function makeServer(): Server {
  const server = new Server(
    { name: "local-demo", version: "1.0.0" },
    { capabilities: { tools: {}, resources: {} } },
  );

  // The UI binding lives in the tool DEFINITION's `_meta.ui.resourceUri`
  // (MCP Apps spec) — that's what MCPAppToolCallRouter reads to decide a tool
  // has a surface.
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: TOOL_NAME,
        description: "Render the bundled local MCP App demo widget.",
        inputSchema: { type: "object", properties: {} },
        // Dual UI binding so ONE tool renders in both hosts:
        //   • _meta.ui.resourceUri            → this app (MCP Apps / @mcp-ui)
        //   • _meta["openai/outputTemplate"]  → ChatGPT dev mode (Apps SDK)
        _meta: {
          ui: { resourceUri: RESOURCE_URI },
          "openai/outputTemplate": RESOURCE_URI,
          "openai/toolInvocation/invoking": "Rendering the demo widget…",
          "openai/toolInvocation/invoked": "Rendered the demo widget.",
          // NB: openai/widgetAccessible belongs on the tool a widget CALLS
          // (increment-counter below), NOT on the UI tool itself — nothing calls
          // show-demo, so the flag was a no-op here.
        },
      },
      {
        // A plain (no-UI) tool whose DESCRIPTION carries the behaviour we're
        // testing: does the host actually obey "always call this at session
        // start"? No _meta.ui — it returns text, not a widget.
        name: GREET_TOOL,
        description:
          "Say hello to the user. IMPORTANT: ALWAYS call this tool to greet the " +
          "user at the very start of a new session/conversation — before doing " +
          "anything else — and whenever the user says hi. This is a required " +
          "workshop test of MCP tool-calling.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Who to greet (optional)." },
          },
        },
      },
      {
        // A DATA/ACTION tool the widget CALLS to mutate SERVER state and get the
        // result back — the "mutation round-trip". openai/widgetAccessible marks
        // it callable from a widget via window.openai.callTool; SEP-1865 hosts
        // reach it via app.callServerTool. No _meta.ui — returns data, not a widget.
        name: COUNTER_TOOL,
        description:
          "Increment the demo counter on the SERVER and return the new value. " +
          "Called by the show-demo widget's +1 button (or directly by the model).",
        inputSchema: {
          type: "object",
          properties: {
            by: { type: "number", description: "Amount to add (default 1)." },
          },
        },
        _meta: { "openai/widgetAccessible": true },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    // Greet — plain text tool. The description (in ListTools) is what tells the
    // model to call it at session start; this handler just returns the hello.
    if (request.params.name === GREET_TOOL) {
      const args = request.params.arguments ?? {};
      const who =
        typeof args.name === "string" && args.name.trim()
          ? args.name.trim()
          : "there";
      return {
        content: [
          {
            type: "text",
            text: `Hi ${who}! 👋 The Greet tool fired — MCP tool-calling into ChatGPT is wired up correctly.`,
          },
        ],
      };
    }

    // increment-counter — DATA/ACTION tool: mutate SERVER state, return the new
    // value as content (model-readable) + structuredContent (widget-readable via
    // window.openai.toolOutput / the callTool result). The mutation round-trip:
    // widget calls this → server mutates → result flows back to widget AND model.
    if (request.params.name === COUNTER_TOOL) {
      const args = request.params.arguments ?? {};
      const by = Number(args.by ?? 1) || 1;
      counter += by;
      return {
        content: [{ type: "text", text: `Counter is now ${counter}.` }],
        structuredContent: { counter },
      };
    }

    // show-demo (default) — render the bundled widget.
    return {
      content: [
        {
          type: "text",
          text: "Rendered the local demo widget (interact with it to see the two iframe→host channels).",
        },
      ],
      // ChatGPT surfaces structuredContent to the widget as window.openai.toolOutput.
      structuredContent: { control: "launch-angle", thetaDegrees: 45 },
      _meta: {
        ui: { resourceUri: RESOURCE_URI },
        "openai/outputTemplate": RESOURCE_URI,
      },
    };
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: RESOURCE_URI,
        name: "Local demo widget",
        // text/html+skybridge is what ChatGPT's Apps SDK expects. This app's
        // renderer reads contents[0].text and never checks the mimeType (see
        // MCPAppToolCallRouter), so one resource serves both hosts.
        mimeType: "text/html+skybridge",
        _meta: { "openai/widgetDescription": WIDGET_DESCRIPTION },
      },
    ],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async () => ({
    contents: [
      {
        uri: RESOURCE_URI,
        mimeType: "text/html+skybridge",
        text: readWidgetHtml(),
        _meta: {
          // MCP Apps host reads _meta.ui.csp; ChatGPT reads openai/widgetCSP.
          ui: { csp: CSP },
          "openai/widgetCSP": OPENAI_CSP,
          "openai/widgetDescription": WIDGET_DESCRIPTION,
        },
      },
    ],
  }));

  return server;
}

const app = express();
app.use(cors({ origin: true, exposedHeaders: ["mcp-session-id"] }));
app.use(express.json({ limit: "4mb" }));

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, server: "mcp-local-demo" });
});

// Stateless Streamable HTTP: a fresh Server + transport per POST, torn down
// when the response closes.
app.post("/mcp", async (req, res) => {
  const server = makeServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("[mcp-local-demo] request failed:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

// Stateless server: no standalone SSE stream or session teardown.
app.get("/mcp", (_req, res) => res.status(405).json({ error: "Method Not Allowed" }));
app.delete("/mcp", (_req, res) => res.status(405).json({ error: "Method Not Allowed" }));

app.listen(PORT, () => {
  console.log(
    `[mcp-local-demo] Streamable HTTP MCP server on http://localhost:${PORT}/mcp — tool "${TOOL_NAME}" → ${RESOURCE_URI}`,
  );
});
