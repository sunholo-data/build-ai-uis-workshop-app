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
// map-server is CORS-enabled). Dev-only — never deployed.

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
const RESOURCE_URI = "ui://local-demo/widget/v1";
// Read per-request (not cached at boot) so editing widget.html is live in dev
// without restarting this server.
const WIDGET_PATH = join(__dirname, "widget.html");
const readWidgetHtml = (): string => readFileSync(WIDGET_PATH, "utf8");

// Empty domain lists — the widget is self-contained (inline script/style, no
// network). The sandbox always allows inline script/style regardless (see
// infrastructure/mcp-sandbox/src/serve.ts buildCspHeader), so this is enough.
const CSP = { resourceDomains: [], connectDomains: [], frameDomains: [] };

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
        _meta: { ui: { resourceUri: RESOURCE_URI } },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async () => ({
    content: [
      {
        type: "text",
        text: "Rendered the local demo widget (interact with it to see the two iframe→host channels).",
      },
    ],
    _meta: { ui: { resourceUri: RESOURCE_URI } },
  }));

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: RESOURCE_URI,
        name: "Local demo widget",
        mimeType: "text/html;profile=mcp-app",
      },
    ],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async () => ({
    contents: [
      {
        uri: RESOURCE_URI,
        mimeType: "text/html;profile=mcp-app",
        text: readWidgetHtml(),
        _meta: { ui: { csp: CSP } },
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
