// Shared bits for the /dev/mcp-apps/{active,passive} smoke pages: the MCP
// server options (local map-server vs live AIPLA sims), the connect-on-select
// lifecycle, the radio selector, and the "how to run it / why it's blank"
// status note. Kept in one place so both pages stay in lock-step.
//
// Leading underscore → Next.js treats this as a private file, not a route.

"use client";

import { type ReactNode, useEffect, useState } from "react";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createDevDirectMcpClient } from "@/lib/mcpClient";
import { TRANSPORT_FIELD } from "@/lib/branding";
import type { ToolCallState } from "@/hooks/useSkillAgent";

// How to reach a server. Local map-server is CORS-enabled → connect directly.
// AIPLA's endpoint doesn't send CORS headers, so a direct browser connection
// is blocked — we go through the same-origin dev proxy (/dev/mcp-proxy/[target]).
type ConnectVia =
  | { kind: "direct"; url: string }
  | { kind: "proxy"; target: string };

export interface ServerOption {
  id: string;
  label: string;
  /** Human-readable endpoint shown in the UI. */
  displayUrl: string;
  description: string;
  /** MCP server id the router uses to attribute the tool call. */
  serverId: string;
  connect: ConnectVia;
  /** Fixture tool call the router attempts (name must be a tool the server
   * exposes + binds to a ui:// resource). */
  toolCall: ToolCallState;
  /** Shown while connecting / on failure — how to get this server running. */
  runHint: ReactNode;
}

// The bundled local server's show-demo tool renders its own default state from
// the ui:// resource, so no captured tool result is needed.
const SHOW_DEMO_FIXTURE: ToolCallState = {
  id: "fixture-show-demo-1",
  name: "show-demo",
  status: "success",
  parentMessageId: "fixture-asst-1",
  argsJson: "{}",
  resultContent: "",
};

// AIPLA's show_boldkast renders its own default state from the ui:// resource,
// so no captured tool result is needed — AppRenderer tolerates an absent one.
const SHOW_BOLDKAST_FIXTURE: ToolCallState = {
  id: "fixture-show-boldkast-1",
  name: "show_boldkast",
  status: "success",
  parentMessageId: "fixture-asst-1",
  argsJson: "{}",
  resultContent: "",
};

export const SERVER_OPTIONS: readonly ServerOption[] = [
  {
    id: "local-demo",
    label: "Local demo widget",
    displayUrl: "http://localhost:3001/mcp",
    description:
      "Bundled with the app — a tiny widget that fires both channels. Started by make dev-local; no external clone.",
    serverId: "local-demo",
    connect: { kind: "direct", url: "http://localhost:3001/mcp" },
    toolCall: SHOW_DEMO_FIXTURE,
    runHint: (
      <>
        The local demo MCP server is part of <code>make dev-local</code> (port
        3001) — no external clone. If it didn{"'"}t start, check{" "}
        <code>.dev-logs/mcp-local-demo.log</code>. Rendering the iframe also
        needs the MCP sandbox on <code>:3457</code> (also part of{" "}
        <code>make dev-local</code>).
      </>
    ),
  },
  {
    id: "aipla-live",
    label: "Live AIPLA sims (boldkast)",
    displayUrl: "https://aipla-v01-frontend-…run.app/api/mcp",
    description:
      "The deployed no-auth demo server — renders the boldkast projectile sim.",
    serverId: "aipla-sims",
    connect: { kind: "proxy", target: "aipla" },
    toolCall: SHOW_BOLDKAST_FIXTURE,
    runHint: (
      <>
        Nothing to start locally — reached via the same-origin dev proxy (
        <code>/dev/mcp-proxy/aipla</code>) because the endpoint is CORS-blocked
        for direct browser calls. The first request may be slow (Cloud Run cold
        start) — retry once. Rendering the iframe still needs the MCP sandbox on{" "}
        <code>:3457</code>.
      </>
    ),
  },
] as const;

export type ConnState = "connecting" | "connected" | "error";

export interface DevMcpConnection {
  selected: ServerOption;
  devClient: Client | null;
  connState: ConnState;
  connError: string | null;
}

/**
 * Connect (or reconnect) to the selected MCP server whenever the selection
 * changes. Direct for the CORS-enabled local server; via the same-origin dev
 * proxy for AIPLA. A cancelled flag guards against a slow connect from a prior
 * selection landing after the user switched.
 */
export function useDevMcpConnection(selectedId: string): DevMcpConnection {
  const selected =
    SERVER_OPTIONS.find((s) => s.id === selectedId) ?? SERVER_OPTIONS[0];
  const [devClient, setDevClient] = useState<Client | null>(null);
  const [connState, setConnState] = useState<ConnState>("connecting");
  const [connError, setConnError] = useState<string | null>(null);

  useEffect(() => {
    const opt = SERVER_OPTIONS.find((s) => s.id === selectedId);
    if (!opt) return;
    let cancelled = false;
    setDevClient(null);
    setConnState("connecting");
    setConnError(null);

    const url =
      opt.connect.kind === "direct"
        ? opt.connect.url
        : `${window.location.origin}/dev/mcp-proxy/${opt.connect.target}`;

    const client = createDevDirectMcpClient(url);
    const transport = (client as unknown as Record<string, unknown>)[
      TRANSPORT_FIELD
    ] as Parameters<Client["connect"]>[0];

    client.connect(transport).then(
      () => {
        if (cancelled) {
          void client.close?.();
          return;
        }
        setDevClient(client);
        setConnState("connected");
      },
      (err: unknown) => {
        if (cancelled) return;
        console.warn("dev mcp connect failed", url, err);
        setConnState("error");
        setConnError(err instanceof Error ? err.message : String(err));
      },
    );

    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  return { selected, devClient, connState, connError };
}

/** Radio group for picking the MCP server. */
export function McpServerSelector({
  selectedId,
  onSelect,
}: {
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="space-y-2">
      {SERVER_OPTIONS.map((opt) => (
        <label
          key={opt.id}
          className="flex cursor-pointer gap-2 rounded border p-2 text-sm hover:bg-muted"
        >
          <input
            type="radio"
            name="mcp-server"
            value={opt.id}
            checked={selectedId === opt.id}
            onChange={() => onSelect(opt.id)}
            className="mt-0.5"
          />
          <span className="space-y-0.5">
            <span className="block font-medium">{opt.label}</span>
            <span className="block text-xs text-muted-foreground">
              <code>{opt.displayUrl}</code> — {opt.description}
            </span>
          </span>
        </label>
      ))}
    </div>
  );
}

/**
 * Connection status shown above the iframe: never a silent blank box. While
 * connecting or on failure it also spells out how to get the server running
 * (`runHint`). When connected it renders nothing — the router takes over.
 */
export function McpConnectionNote({
  selected,
  connState,
  connError,
}: {
  selected: ServerOption;
  connState: ConnState;
  connError: string | null;
}) {
  if (connState === "connected") return null;
  return (
    <div className="space-y-1" role="status">
      {connState === "connecting" ? (
        <p className="text-xs text-amber-600">
          Connecting to {selected.label} (<code>{selected.displayUrl}</code>)…
        </p>
      ) : (
        <p className="text-xs text-destructive">
          Could not connect to {selected.label} (
          <code>{selected.displayUrl}</code>)
          {connError ? `: ${connError}` : ""}.
        </p>
      )}
      <p className="text-xs text-muted-foreground">{selected.runHint}</p>
    </div>
  );
}
