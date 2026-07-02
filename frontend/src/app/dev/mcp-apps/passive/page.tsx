// /dev/mcp-apps/passive — fixture-driven render of MCPAppToolCallRouter.
// No chat-message bridge; just confirms the router mounts AppRenderer for a
// real captured CallToolResult and surfaces any AppRenderer.onError.
//
// SERVER SELECTOR (see _shared.tsx): the local map-server (:3001 — the Cesium
// globe) or the live AIPLA sims (the boldkast projectile widget, via the
// same-origin dev proxy). When nothing renders, the box explains why
// (connection status + how to run the server) plus the router's own
// renderDiagnostics — never a silent blank box.
//
// Run: open http://localhost:3456/dev/mcp-apps/passive (needs the MCP sandbox
// proxy on :3457 — part of `make dev-local`). No Firebase login needed: the
// dev client connects directly (local) or through the dev proxy (AIPLA).

"use client";

import { useState } from "react";
import { MCPAppToolCallRouter } from "@/components/protocols/MCPAppToolCallRouter";
import {
  McpConnectionNote,
  McpServerSelector,
  SERVER_OPTIONS,
  useDevMcpConnection,
} from "../_shared";

export default function McpAppsPassivePage() {
  const [selectedId, setSelectedId] = useState<string>(SERVER_OPTIONS[0].id);
  const { selected, devClient, connState, connError } =
    useDevMcpConnection(selectedId);

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">MCP Apps passive smoke</h1>
        <p className="text-sm text-muted-foreground">
          Fixture-driven render of <code>MCPAppToolCallRouter</code> with no{" "}
          <code>onChatMessage</code> bridge — it just mounts the selected
          server{"'"}s widget so you can triage surface-rendering bugs. Needs the
          MCP sandbox proxy on <code>:3457</code>.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">MCP server</h2>
        <McpServerSelector selectedId={selectedId} onSelect={setSelectedId} />
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Rendered widget</h2>
        <div className="rounded border p-3">
          <McpConnectionNote
            selected={selected}
            connState={connState}
            connError={connError}
          />
          {connState === "connected" && devClient && (
            <MCPAppToolCallRouter
              key={selected.id}
              toolCalls={[selected.toolCall]}
              mcpServerIds={[selected.serverId]}
              devClient={devClient}
              renderDiagnostics
            />
          )}
        </div>
      </section>
    </main>
  );
}
