// /dev/mcp-apps/active — full active iframe → host bridge.
//
// Mounts MCPAppToolCallRouter with a stubbed onChatMessage that appends
// to an on-page log instead of calling sendMessage. Plus a panel of
// buttons that synthesise common iframe notifications and route them
// through the same notification adapter, so you can exercise the bridge
// without a running iframe.
//
// SERVER SELECTOR (see _shared.tsx): pick which MCP server the iframe connects
// to — the local map-server (:3001, connected directly) or the live AIPLA sims
// (via the same-origin dev proxy). When nothing renders, the box shows WHY
// (connection status + how to run the server) plus the router's own
// renderDiagnostics — never a silent blank.
//
// Run: open http://localhost:3456/dev/mcp-apps/active

"use client";

import { useCallback, useEffect, useState } from "react";
import {
  MCPAppToolCallRouter,
  type ModelContextUpdate,
} from "@/components/protocols/MCPAppToolCallRouter";
import { notificationToChatMessage } from "@/components/protocols/mcpAppNotificationAdapter";
import {
  McpConnectionNote,
  McpServerSelector,
  SERVER_OPTIONS,
  useDevMcpConnection,
} from "../_shared";

interface SyntheticNotification {
  label: string;
  payload: unknown;
}

const SYNTHETIC_NOTIFICATIONS: readonly SyntheticNotification[] = [
  {
    label: "location-selected (Munich)",
    payload: { type: "app/notify", reason: "location-selected", payload: { location: "Munich" } },
  },
  {
    label: "location-selected (Paris)",
    payload: { type: "app/notify", reason: "location-selected", payload: { location: "Paris" } },
  },
  {
    label: "route-selected (Munich → Paris)",
    payload: { type: "app/notify", reason: "route-selected", payload: { from: "Munich", to: "Paris" } },
  },
  {
    label: "unknown-shape",
    payload: { type: "app/notify", reason: "spaceship-launched", payload: { destination: "Mars" } },
  },
  {
    label: "malformed (missing payload)",
    payload: { type: "app/notify", reason: "location-selected" },
  },
] as const;

interface LogEntry {
  ts: number;
  // "iframe-bridge"        → app/notify message (map-server), adapter-translated
  // "iframe-model-context" → ui/update-model-context push (AIPLA sims) — sniffed
  //                          off the wire (it's a notification the SDK doesn't surface)
  // "iframe-wire"          → other guest→host protocol frames (handshake, etc.)
  // "synthetic-button"     → the buttons below, bypassing the iframe
  source:
    | "iframe-bridge"
    | "iframe-model-context"
    | "iframe-wire"
    | "synthetic-button";
  notificationLabel?: string;
  translated: string | null;
}

// Per-source chip: the wire method name + a colour, so the log visibly maps
// each entry to one of the channels explained in the legend.
const SOURCE_META: Record<
  LogEntry["source"],
  { chip: string; cls: string }
> = {
  "iframe-bridge": {
    chip: "app/notify",
    cls: "border-blue-300 bg-blue-100 text-blue-700",
  },
  "iframe-model-context": {
    chip: "ui/update-model-context",
    cls: "border-violet-300 bg-violet-100 text-violet-700",
  },
  "iframe-wire": {
    chip: "wire",
    cls: "border-emerald-300 bg-emerald-50 text-emerald-700",
  },
  "synthetic-button": {
    chip: "synthetic",
    cls: "border-border bg-muted text-muted-foreground",
  },
};

// Mirror each log entry to the browser console, tagged with its channel, so
// DevTools narrates the two MCP-Apps back-channels too. /dev playground only.
function logChannel(
  source: LogEntry["source"],
  label: string | undefined,
  translated: string | null,
) {
  console.groupCollapsed(
    `%c[mcp-apps]%c ${SOURCE_META[source].chip}${label ? ` · ${label}` : ""}`,
    "color:#e73c17;font-weight:700",
    "color:inherit;font-weight:700",
  );
  console.log(
    source === "iframe-model-context"
      ? "ui/update-model-context — structured state for the agent's next turn:"
      : "→ chat turn (ui/message) the host would send:",
    translated ?? "null (adapter ignored this shape)",
  );
  console.groupEnd();
}

export default function McpAppsActivePage() {
  const [log, setLog] = useState<LogEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string>(SERVER_OPTIONS[0].id);
  // Host-side height clamp, driven off the widget's own ui/notifications/
  // size-changed sniffed below. Deterministic + independent of AppFrame's
  // proxy-ready handshake (which can time out in the vendored SDK), so the
  // iframe never sits at the 600px default. Reset on server switch.
  const [widgetHeight, setWidgetHeight] = useState<number | null>(null);
  const { selected, devClient, connState, connError } =
    useDevMcpConnection(selectedId);

  useEffect(() => {
    setWidgetHeight(null);
  }, [selectedId]);

  useEffect(() => {
    console.log(
      "%c/dev/mcp-apps/active%c — MCP Apps bridge. Click a %cSynthetic notification%c (or drag a live widget) and watch each back-channel message log here.",
      "color:#e73c17;font-weight:700",
      "color:inherit",
      "font-weight:700",
      "color:inherit",
    );
  }, []);

  function appendLog(entry: Omit<LogEntry, "ts">) {
    logChannel(entry.source, entry.notificationLabel, entry.translated);
    setLog((prev) => [...prev, { ...entry, ts: Date.now() }]);
  }

  // Stable handler identities (functional setState, no deps) so appending to
  // the log doesn't re-render with fresh callbacks — which would change the
  // router's props and remount the sandbox iframe (proxy-ready timeout + the
  // widget resetting to 600px on every interaction).
  const handleChatMessage = useCallback((text: string) => {
    logChannel("iframe-bridge", undefined, text);
    setLog((prev) => [
      ...prev,
      { ts: Date.now(), source: "iframe-bridge", translated: text },
    ]);
  }, []);

  const handleModelContextUpdate = useCallback((u: ModelContextUpdate) => {
    const translated = JSON.stringify(u.structuredContent ?? u.content ?? {});
    logChannel("iframe-model-context", undefined, translated);
    setLog((prev) => [
      ...prev,
      { ts: Date.now(), source: "iframe-model-context", translated },
    ]);
  }, []);

  function fireSynthetic(n: SyntheticNotification) {
    const translated = notificationToChatMessage(n.payload);
    appendLog({
      source: "synthetic-button",
      notificationLabel: n.label,
      translated,
    });
  }

  function clearLog() {
    setLog([]);
  }

  // Raw wire sniffer — the reliable way to see the model-context channel.
  // boldkast pushes `ui/update-model-context` as a JSON-RPC *notification*
  // (no id) via window.parent.postMessage. AppRenderer only exposes callbacks
  // for *requests* (onFallbackRequest) and app/notify (onMessage), so those
  // notifications never reach a React handler — that's gotcha #18. But the
  // sandbox relays every guest frame to THIS window verbatim
  // (infrastructure/mcp-sandbox/src/sandbox.ts → window.parent.postMessage),
  // so we listen on the host window directly. We only log NOTIFICATIONS here
  // (no id); request-shaped frames are already handled by the router callbacks
  // above, so this never double-logs them.
  useEffect(() => {
    function onWire(event: MessageEvent) {
      // The `jsonrpc: "2.0"` shape is a strong enough filter on its own —
      // Next HMR / React-DevTools postMessages don't carry it — so we DON'T
      // hard-filter on origin. (Origin-filtering here once silently swallowed
      // everything when the sandbox URL didn't match; the shape check is safer.)
      const data = event.data as {
        jsonrpc?: string;
        id?: unknown;
        method?: unknown;
        params?: unknown;
      } | null;
      if (!data || typeof data !== "object" || data.jsonrpc !== "2.0") return;
      if (data.id !== undefined) return; // a request/response — handled elsewhere
      const method = data.method;
      if (typeof method !== "string") return;

      if (method === "ui/notifications/size-changed") {
        // Clamp the iframe to the height the widget reports for itself — the
        // reliable path to a compact render (AppFrame's own auto-resize is
        // gated on the proxy-ready handshake, which can time out).
        const h = (data.params as { height?: unknown } | undefined)?.height;
        if (typeof h === "number" && h > 0) setWidgetHeight(Math.ceil(h));
        return;
      }

      if (method === "ui/update-model-context") {
        const params = (data.params ?? {}) as { structuredContent?: unknown };
        setLog((prev) => [
          ...prev,
          {
            ts: Date.now(),
            source: "iframe-model-context",
            translated: JSON.stringify(params.structuredContent ?? params),
          },
        ]);
      } else {
        // Handshake / protocol frames (…/initialized, proxy-ready, …) — dim
        // wire entries so the pipeline is visible without dominating the log.
        const raw = JSON.stringify(data.params ?? {});
        setLog((prev) => [
          ...prev,
          {
            ts: Date.now(),
            source: "iframe-wire",
            notificationLabel: method,
            translated: raw.length > 120 ? `${raw.slice(0, 117)}…` : raw,
          },
        ]);
      }
    }

    window.addEventListener("message", onWire);
    return () => window.removeEventListener("message", onWire);
  }, []);

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">MCP Apps active smoke</h1>
        <p className="text-sm text-muted-foreground">
          Full active iframe → host bridge. The router{"'"}s{" "}
          <code>onChatMessage</code> is wired to the log below instead of
          to <code>useSkillAgent.sendMessage</code> so you can exercise
          the adapter without sending real chat turns.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">MCP server</h2>
        <p className="text-xs text-muted-foreground">
          Choose which server the iframe connects to. If nothing renders, the
          box below explains why.
        </p>
        <McpServerSelector selectedId={selectedId} onSelect={setSelectedId} />
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Iframe (real bridge)</h2>
        <p className="text-xs text-muted-foreground">
          Interact with the widget (drag a boldkast slider) and watch the log
          below — see <em>The two iframe→host channels</em> for what fires and
          why.
        </p>
        <div className="rounded border p-3">
          <McpConnectionNote
            selected={selected}
            connState={connState}
            connError={connError}
          />
          {connState === "connected" && devClient && (
            <div
              style={widgetHeight ? { height: `${widgetHeight}px` } : undefined}
              className={
                widgetHeight
                  ? "overflow-hidden transition-[height] duration-150"
                  : undefined
              }
            >
              <MCPAppToolCallRouter
                key={selected.id}
                toolCalls={[selected.toolCall]}
                mcpServerIds={[selected.serverId]}
                devClient={devClient}
                renderDiagnostics
                onChatMessage={handleChatMessage}
                onModelContextUpdate={handleModelContextUpdate}
              />
            </div>
          )}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Synthetic notifications</h2>
        <p className="text-xs text-muted-foreground">
          Bypasses the iframe; sends each payload directly to the
          <code>notificationToChatMessage</code> adapter. Useful when the
          iframe isn{"'"}t reachable or you want to verify a specific
          adapter case fast.
        </p>
        <div className="flex flex-wrap gap-2">
          {SYNTHETIC_NOTIFICATIONS.map((n) => (
            <button
              key={n.label}
              type="button"
              onClick={() => fireSynthetic(n)}
              className="rounded border px-3 py-1 text-xs hover:bg-muted"
            >
              fire: {n.label}
            </button>
          ))}
          <button
            type="button"
            onClick={clearLog}
            className="rounded border border-destructive px-3 py-1 text-xs text-destructive hover:bg-destructive/10"
          >
            clear log
          </button>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">The two iframe→host channels</h2>
        <p className="text-xs text-muted-foreground">
          MCP Apps hosts agree on how to <em>render</em> a widget, but differ on
          the interaction back-channel (protocol-gotchas #18). A widget can talk
          back two ways — the log tags every message with which one it used:
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1 rounded border p-3">
            <span
              className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${SOURCE_META["iframe-bridge"].cls}`}
            >
              app/notify
            </span>
            <p className="text-xs text-muted-foreground">
              {'"'}Please start a chat turn.{'"'} The host adapter translates it
              into a message the user would have typed.{" "}
              <strong>Map-server:</strong> click a place →{" "}
              <em>{'"'}Tell me more about Munich.{'"'}</em>
            </p>
          </div>
          <div className="space-y-1 rounded border p-3">
            <span
              className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${SOURCE_META["iframe-model-context"].cls}`}
            >
              ui/update-model-context
            </span>
            <p className="text-xs text-muted-foreground">
              {'"'}Here{"'"}s what{"'"}s on screen / what I just did.{'"'} No chat
              turn — it updates the agent{"'"}s next-turn context.{" "}
              <strong>AIPLA sims:</strong> drag a slider → structured state
              pushed. This is what <strong>boldkast</strong> fires.
            </p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          The catch (this is the deep half of #18): boldkast sends{" "}
          <code>ui/update-model-context</code> as a raw JSON-RPC{" "}
          <em>notification</em>, and <code>@mcp-ui/client</code> only surfaces{" "}
          <em>requests</em> to the host — so the SDK callbacks never see it. This
          page sniffs the sandbox↔host <code>postMessage</code> wire directly to
          show it. That{"'"}s exactly why {'"'}the model stays blind{'"'} in some
          hosts even though the widget renders.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Message log</h2>
        {log.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            No messages yet. Drag a boldkast slider (or click a synthetic button)
            to see which channel each interaction uses.
          </p>
        ) : (
          <ol className="space-y-2 rounded border bg-muted/30 p-3 font-mono text-xs">
            {log.map((entry, i) => {
              const meta = SOURCE_META[entry.source];
              return (
                <li key={i} className="flex items-start gap-2 border-l-2 border-primary pl-2">
                  <span
                    className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${meta.cls}`}
                    title={entry.source}
                  >
                    {meta.chip}
                  </span>
                  <span className="min-w-0 break-words">
                    <span className="text-muted-foreground">
                      [{new Date(entry.ts).toLocaleTimeString()}]
                      {entry.notificationLabel ? ` ${entry.notificationLabel}` : ""}{" "}
                      →{" "}
                    </span>
                    {entry.translated === null ? (
                      <span className="text-muted-foreground">
                        null (adapter ignored)
                      </span>
                    ) : (
                      <span className="text-primary">{entry.translated}</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </main>
  );
}
