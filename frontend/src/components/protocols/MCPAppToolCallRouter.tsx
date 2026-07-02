// M2A — MCP App tool-call router
//
// For each tool call coming through useSkillAgent.toolCalls, decide whether
// it has an MCP App UI surface. If yes, mount <AppRenderer> from
// @mcp-ui/client wired to the right MCP Client. If no, render nothing —
// MessageBubble's existing ToolCallChip path handles non-UI tool calls.
//
// Per spec the UI binding lives in the tool DEFINITION, not the result:
// `_meta.ui.resourceUri` (and the spec-alt key `_meta["ui/resourceUri"]`).
// We fetch tool defs lazily via client.listTools() the first time we see
// a tool call for that server, cache them in component state, and decide
// based on _meta.ui.
//
// Tool-name prefix: when the backend uses ADK's `tool_name_prefix`, tools
// arrive as `<server_id>_<tool_name>`. We accept that shape and the
// unprefixed shape (current backend wiring doesn't pass tool_name_prefix
// — see backend/tools/mcp/registry.py). The parser is a pure function for
// testability.

"use client";

import { AppRenderer } from "@mcp-ui/client";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import type { ToolCallState } from "@/hooks/useSkillAgent";
import { fetchWithAuth } from "@/lib/apiClient";
import { useMcpClient } from "@/lib/mcpClient";
import { notificationToChatMessage } from "@/components/protocols/mcpAppNotificationAdapter";
import { ArtefactRefused } from "./ArtefactRefused";
import { ArtefactWarningStripe } from "./ArtefactWarningStripe";
import {
  type ArtefactDecision,
  type ArtefactReview,
  type ArtefactReviewer,
  getArtefactReviewer,
} from "./ArtefactReviewer";

/** Sandbox proxy URL — MUST be on a different origin than the host per
 * MCP Apps spec (so the inner iframe's allow-same-origin can't read host
 * cookies). Read from NEXT_PUBLIC_MCP_SANDBOX_URL at build time; defaults
 * to the local dev port (3457). See docs/design/v6.1.0/mcp-sandbox-separate-origin.md.
 */
const SANDBOX_PROXY_URL =
  process.env.NEXT_PUBLIC_MCP_SANDBOX_URL || "http://localhost:3457/sandbox.html";

interface ToolDef {
  name: string;
  /** ui:// resource URI to fetch HTML from (via the same MCP client). */
  uiResourceUri?: string;
}

interface ParsedToolCallName {
  serverId: string;
  unprefixedName: string;
}

/** Pure: split a tool-call name into (serverId, unprefixedName) using the
 * known MCP server IDs. ADK's prefix scheme joins with `_`. Returns null
 * if no known serverId matches — caller decides what to do (skip). */
export function parseToolCallName(
  toolCallName: string,
  mcpServerIds: readonly string[],
): ParsedToolCallName | null {
  for (const serverId of mcpServerIds) {
    // Prefixed shape: <server_id>_<tool_name>
    const prefix = `${serverId}_`;
    if (toolCallName.startsWith(prefix)) {
      return { serverId, unprefixedName: toolCallName.slice(prefix.length) };
    }
  }
  // Unprefixed: when there's a single configured server we can attribute
  // tool calls to it directly (matches current backend wiring where
  // tool_name_prefix is not set). When there are multiple servers
  // configured we can't safely guess; skip.
  if (mcpServerIds.length === 1) {
    return { serverId: mcpServerIds[0], unprefixedName: toolCallName };
  }
  return null;
}

/** Pure: pick the UI resource URI off a tool definition's _meta block.
 * The fixture confirms both keys appear — handle either. */
function extractUiResourceUri(tool: unknown): string | undefined {
  if (!tool || typeof tool !== "object") return undefined;
  const meta = (tool as { _meta?: unknown })._meta;
  if (!meta || typeof meta !== "object") return undefined;
  const m = meta as Record<string, unknown>;
  const ui = m.ui;
  if (ui && typeof ui === "object") {
    const direct = (ui as { resourceUri?: unknown }).resourceUri;
    if (typeof direct === "string") return direct;
  }
  const slashed = m["ui/resourceUri"];
  if (typeof slashed === "string") return slashed;
  return undefined;
}

/** Pure: parse AG-UI's stringified tool-result content into a CallToolResult.
 * Returns undefined on parse failure or shape mismatch — AppRenderer
 * accepts undefined and the iframe degrades gracefully. */
function parseToolResult(content: string | undefined): CallToolResult | undefined {
  if (!content) return undefined;
  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === "object") return parsed as CallToolResult;
  } catch {
    /* fall through */
  }
  return undefined;
}

/** Pure: parse the concatenated TOOL_CALL_ARGS deltas into a tool-input
 * object. Returns undefined on parse failure or non-object — AppRenderer
 * accepts undefined and the iframe falls back to its own state. */
function parseToolInput(argsJson: string | undefined): Record<string, unknown> | undefined {
  if (!argsJson) return undefined;
  try {
    const parsed = JSON.parse(argsJson);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* fall through */
  }
  return undefined;
}

/** Payload surfaced to `onModelContextUpdate` — the parsed `ui/update-model-context`
 * push from an iframe (MCP Apps channel #2). */
export interface ModelContextUpdate {
  serverId: string;
  toolName: string;
  structuredContent: Record<string, unknown> | null;
  content: unknown[] | null;
}

interface RouterProps {
  toolCalls: ToolCallState[];
  /** MCP server IDs configured for the current skill — used to recognise
   * which tool calls belong to which server. */
  mcpServerIds: readonly string[];
  /** Optional: invoked when the iframe sends a notify-shape message we
   * recognise. Returns a chat string or null. The active iframe→host
   * bridge in MessageBubble passes a sendMessage adaptor here. */
  onChatMessage?: (text: string) => void;
  /** Optional: invoked whenever the iframe pushes `ui/update-model-context`
   * (MCP Apps channel #2 — the "here's what I'm showing / what the user just
   * did" back-channel that standard-only widgets like the AIPLA sims use
   * instead of `app/notify`). Fires regardless of `sessionId`, so /dev/*
   * surfaces can observe the raw pushes even when there's no session to POST
   * them to. Independent of the backend POST below. */
  onModelContextUpdate?: (update: ModelContextUpdate) => void;
  /** Optional: current chat session id. When set, the iframe's
   * `ui/update-model-context` pushes are POSTed to
   * `/api/proxy/api/sessions/{sessionId}/iframe-context` so the agent's
   * NEXT turn can reference what's currently on screen. When unset,
   * pushes are silently dropped (graceful no-op for /dev/* surfaces and
   * pre-first-turn renders). See sprint 1.25. */
  sessionId?: string | null;
  /** Dev-only override: pre-connected Client to use instead of the
   * per-server cache. Useful for /dev/* pages that bypass Firebase auth. */
  devClient?: Client;
  /** Dev-only: when true, render a short human-readable note explaining why
   * NOTHING mounted (client not connected, tool has no ui:// binding, resource
   * still loading, …) instead of silently returning null. Default false keeps
   * production/chat behaviour exactly — non-UI tool calls stay invisible.
   * Used by /dev/* smoke pages so a blank box never looks like a broken demo. */
  renderDiagnostics?: boolean;
  /** When true (default), a `ui/update-model-context` push that actually
   * reaches the backend renders a small "Sent to the assistant" receipt below
   * the widget — the MCP-Apps sibling of A2UISurfaceMount's action-trust strip.
   * Makes the otherwise-invisible back-channel visible: the user can see that
   * dragging a slider fed the agent (and what it fed). Only shows on the chat
   * path (needs a sessionId to POST to); silent on 403 (opt-out skills). */
  showContextTrust?: boolean;
}

/** Compact "k: v, k: v" summary of a structuredContent push, for the trust
 * receipt. Mirrors A2UISurfaceMount.summarizeContext. */
function summarizeStructuredContent(
  sc: Record<string, unknown> | null | undefined,
): string {
  if (!sc || typeof sc !== "object") return "";
  return Object.entries(sc)
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(", ");
}

interface ContextTrust {
  summary: string;
  status: "sending" | "sent" | "error";
}

export function MCPAppToolCallRouter({
  toolCalls,
  mcpServerIds,
  onChatMessage,
  onModelContextUpdate,
  sessionId,
  devClient,
  renderDiagnostics = false,
  showContextTrust = true,
}: RouterProps) {
  return (
    <>
      {toolCalls.map((tc) => {
        const parsed = parseToolCallName(tc.name, mcpServerIds);
        if (!parsed) {
          if (!renderDiagnostics) return null;
          return (
            <RouterDiagnostic key={tc.id} tone="error">
              Tool <code>{tc.name}</code> doesn{"'"}t match any configured MCP
              server ({mcpServerIds.join(", ") || "none"}), so it can{"'"}t be
              routed to an app surface.
            </RouterDiagnostic>
          );
        }
        return (
          <RoutedToolCall
            key={tc.id}
            toolCall={tc}
            serverId={parsed.serverId}
            unprefixedName={parsed.unprefixedName}
            onChatMessage={onChatMessage}
            onModelContextUpdate={onModelContextUpdate}
            sessionId={sessionId}
            devClient={devClient}
            renderDiagnostics={renderDiagnostics}
            showContextTrust={showContextTrust}
          />
        );
      })}
    </>
  );
}

/** Dev-only status line used when `renderDiagnostics` is set. Kept visually
 * quiet (matches the muted/destructive tokens used elsewhere) — it's a
 * debugging aid on /dev/* pages, not a production surface. */
function RouterDiagnostic({
  tone = "wait",
  children,
}: {
  tone?: "wait" | "error";
  children: ReactNode;
}) {
  return (
    <p
      role="status"
      data-testid="mcp-router-diagnostic"
      className={`text-xs ${tone === "error" ? "text-destructive" : "text-muted-foreground"}`}
    >
      {children}
    </p>
  );
}

interface McpUiResourceCsp {
  resourceDomains?: string[];
  connectDomains?: string[];
  frameDomains?: string[];
  baseUriDomains?: string[];
}

interface ResourceResult {
  html: string;
  csp: McpUiResourceCsp | undefined;
}

// Sprint 2.13 — soft budget for ArtefactReviewer.review() calls.
// Reviewers exceeding this degrade to approve + warn log; we never
// hard-fail render on a slow fork-side reviewer.
const REVIEW_BUDGET_MS = 500;

/**
 * Consult the registered reviewer with the soft 500ms budget AND
 * fail-open on crash. Reviewer crash or timeout → approve so the
 * iframe still renders (the sandbox + CSP layer is the safety net,
 * not the reviewer).
 */
async function consultArtefactReviewer(
  reviewer: ArtefactReviewer,
  input: ArtefactReview,
): Promise<ArtefactDecision> {
  // Swallow reviewer rejections so Promise.race semantics stay clean
  // even if the timeout fires first and the reviewer settles later.
  const safeReview = reviewer.review(input).catch((err: unknown) => {
    if (process.env.NODE_ENV !== "production") {
      console.error(
        "[ArtefactReviewer] review threw — falling back to approve",
        err,
      );
    }
    return { action: "approve" } as ArtefactDecision;
  });
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<ArtefactDecision>((resolve) => {
    timeoutHandle = setTimeout(() => {
      if (process.env.NODE_ENV !== "production") {
        console.warn(
          `[ArtefactReviewer] review exceeded ${REVIEW_BUDGET_MS}ms — degrading to approve`,
        );
      }
      resolve({ action: "approve" });
    }, REVIEW_BUDGET_MS);
  });
  const decision = await Promise.race([safeReview, timeoutPromise]);
  if (timeoutHandle) clearTimeout(timeoutHandle);
  return decision;
}

interface RoutedProps {
  toolCall: ToolCallState;
  serverId: string;
  unprefixedName: string;
  onChatMessage?: (text: string) => void;
  onModelContextUpdate?: (update: ModelContextUpdate) => void;
  sessionId?: string | null;
  devClient?: Client;
  renderDiagnostics?: boolean;
  showContextTrust?: boolean;
}

function RoutedToolCall({
  toolCall,
  serverId,
  unprefixedName,
  onChatMessage,
  onModelContextUpdate,
  sessionId,
  devClient,
  renderDiagnostics = false,
  showContextTrust = true,
}: RoutedProps) {
  const hookedClient = useMcpClient(devClient ? null : serverId);
  const client = devClient ?? hookedClient;
  const [defs, setDefs] = useState<ToolDef[] | null>(null);
  const [resource, setResource] = useState<ResourceResult | null>(null);
  // Diagnostics-only: capture the first fetch failure (listTools / readResource)
  // so the dev panel can say "couldn't reach the server" rather than spinning on
  // "loading…" forever. Never read on the production path (renderDiagnostics=false).
  const [fetchError, setFetchError] = useState<string | null>(null);
  // Trust receipt for the most recent ui/update-model-context write (chat path).
  const [contextTrust, setContextTrust] = useState<ContextTrust | null>(null);

  // Step 1: Fetch tool definitions to find the UI resource URI.
  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    void (client as unknown as Client).listTools().then(
      (res) => {
        if (cancelled) return;
        const arr = Array.isArray(
          (res as unknown as { tools?: unknown[] }).tools,
        )
          ? (res as unknown as { tools: unknown[] }).tools
          : [];
        setDefs(
          arr.map((t) => {
            const tt = t as { name?: unknown };
            return {
              name: typeof tt.name === "string" ? tt.name : "",
              uiResourceUri: extractUiResourceUri(t),
            };
          }),
        );
      },
      (err: unknown) => {
        console.warn("MCPAppToolCallRouter: listTools failed", err);
        if (!cancelled) {
          setFetchError(
            `listTools failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      },
    );
    return () => { cancelled = true; };
  }, [client]);

  const def = useMemo(
    () => defs?.find((d) => d.name === unprefixedName) ?? null,
    [defs, unprefixedName],
  );

  // Step 2: Pre-fetch the resource HTML + CSP when we know the URI.
  // Passing `html` to AppRenderer lets it skip its own resources/read call,
  // so there's only one fetch. The CSP from _meta.ui.csp is forwarded to
  // sandbox.csp so our sandbox proxy sets the correct CSP HTTP header.
  useEffect(() => {
    if (!client || !def?.uiResourceUri) return;
    let cancelled = false;
    void (client as unknown as Client)
      .readResource({ uri: def.uiResourceUri })
      .then(
        (res) => {
          if (cancelled) return;
          const content = (res as unknown as { contents?: unknown[] }).contents?.[0];
          if (!content || typeof content !== "object") return;
          const c = content as Record<string, unknown>;
          const text = typeof c.text === "string" ? c.text : null;
          if (!text) return;
          // Extract CSP from _meta.ui.csp (MCP Apps spec §4.3)
          const meta = c._meta as { ui?: { csp?: McpUiResourceCsp } } | undefined;
          const csp = meta?.ui?.csp ?? undefined;
          setResource({ html: text, csp });
        },
        (err: unknown) => {
          console.warn("MCPAppToolCallRouter: readResource failed", err);
          if (!cancelled) {
            setFetchError(
              `readResource failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        },
      );
    return () => { cancelled = true; };
  }, [client, def?.uiResourceUri]);

  const toolResult = useMemo(
    () => parseToolResult(toolCall.resultContent),
    [toolCall.resultContent],
  );
  const toolInput = useMemo(
    () => parseToolInput(toolCall.argsJson),
    [toolCall.argsJson],
  );

  // Memoize sandbox config so AppRenderer doesn't see a fresh URL/csp object
  // identity on every render. AppFrame compares URL.href + bridge ref to
  // decide whether to recreate the iframe; an unstable prop causes it to
  // teardown + remount, racing with our sandbox's proxy-ready postMessage
  // and producing the "Timed out waiting for sandbox proxy iframe to be
  // ready" error.
  const sandboxConfig = useMemo(
    () => ({ url: new URL(SANDBOX_PROXY_URL), csp: resource?.csp }),
    [resource?.csp],
  );

  // Sprint 2.13 — consult the registered ArtefactReviewer once per
  // (resource, toolCallId). The reviewer fires AFTER readResource has
  // resolved but BEFORE <AppRenderer> mounts the iframe. A buggy
  // reviewer fails open (sandbox is the safety net). Decision is
  // cached in component state so we don't re-consult on every render.
  const [decision, setDecision] = useState<ArtefactDecision | null>(null);

  useEffect(() => {
    if (!resource || !def?.uiResourceUri) return;
    let cancelled = false;
    const review: ArtefactReview = {
      toolName: unprefixedName,
      serverId,
      resourceUri: def.uiResourceUri,
      html: resource.html,
      csp: resource.csp ? JSON.stringify(resource.csp) : null,
      structuredContent: toolResult,
      invocationId: toolCall.id,
    };
    const reviewer: ArtefactReviewer = getArtefactReviewer();
    void consultArtefactReviewer(reviewer, review).then((d) => {
      if (!cancelled) setDecision(d);
    });
    return () => {
      cancelled = true;
    };
    // Re-consult only when the resolved html or tool-call identity
    // changes — toolResult re-derives from a stable argsJson and
    // shouldn't refire the gate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resource?.html, def?.uiResourceUri, serverId, unprefixedName, toolCall.id]);

  // Each guard preserves the production contract (return null) when
  // renderDiagnostics is off; the dev branch explains what state we're stuck in.
  if (!client) {
    if (!renderDiagnostics) return null;
    return (
      <RouterDiagnostic tone="wait">
        Connecting to MCP server <code>{serverId}</code>… If this doesn{"'"}t
        clear, the server may be unreachable (is it running? is the browser
        request blocked by CORS?).
      </RouterDiagnostic>
    );
  }
  if (fetchError) {
    if (!renderDiagnostics) return null;
    return (
      <RouterDiagnostic tone="error">
        Couldn{"'"}t load the app from <code>{serverId}</code>: {fetchError}.
        Common causes: server down, a <code>502</code> cold start, or the
        browser blocked a cross-origin request (CORS).
      </RouterDiagnostic>
    );
  }
  if (!defs) {
    if (!renderDiagnostics) return null;
    return (
      <RouterDiagnostic tone="wait">
        Loading tool definitions from <code>{serverId}</code>…
      </RouterDiagnostic>
    );
  }
  if (!def) {
    if (!renderDiagnostics) return null;
    return (
      <RouterDiagnostic tone="error">
        Server <code>{serverId}</code> has no tool named{" "}
        <code>{unprefixedName}</code>. Tools it exposes:{" "}
        {defs.length ? defs.map((d) => d.name).join(", ") : "(none)"}.
      </RouterDiagnostic>
    );
  }
  if (!def.uiResourceUri) {
    if (!renderDiagnostics) return null; // no UI binding → skip
    return (
      <RouterDiagnostic tone="error">
        Tool <code>{unprefixedName}</code> has no MCP App UI binding (no{" "}
        <code>_meta.ui.resourceUri</code>) on this server — there{"'"}s no
        widget to render. See protocol-gotchas #16.
      </RouterDiagnostic>
    );
  }
  if (!resource) {
    if (!renderDiagnostics) return null; // resource still loading
    return (
      <RouterDiagnostic tone="wait">
        Loading UI resource <code>{def.uiResourceUri}</code>…
      </RouterDiagnostic>
    );
  }
  if (!decision) {
    if (!renderDiagnostics) return null; // reviewer consult still in flight
    return (
      <RouterDiagnostic tone="wait">Reviewing artefact…</RouterDiagnostic>
    );
  }

  // Sprint 2.13 — block path returns BEFORE the iframe is mounted.
  // The sandbox + CSP layer is still in place under us, but the
  // user-facing claim is "this artefact didn't pass the gate"; the
  // iframe never loads. ArtefactRefused fires the audit POST on
  // mount.
  if (decision.action === "block") {
    return (
      <ArtefactRefused
        decision={decision}
        toolName={unprefixedName}
        serverId={serverId}
        invocationId={toolCall.id}
        sessionId={sessionId}
      />
    );
  }

  const renderedApp = (
    <AppRenderer
      client={client}
      toolName={unprefixedName}
      toolInput={toolInput}
      toolResult={toolResult}
      html={resource.html}
      sandbox={sandboxConfig}
      onMessage={async (params) => {
        const text = notificationToChatMessage(params);
        if (text && onChatMessage) onChatMessage(text);
        return {};
      }}
      onFallbackRequest={async (request) => {
        // MCP Apps spec channel #2 (sprint 1.25): the iframe pushes
        // structured content into the agent's NEXT-turn context via
        // ui/update-model-context. AppRenderer doesn't have a
        // dedicated prop for it — it surfaces via onFallbackRequest
        // (the catch-all for JSON-RPC methods AppRenderer doesn't
        // route specifically). We dispatch on method name.
        //
        // POST to /api/proxy/api/sessions/{sessionId}/iframe-context;
        // backend writes to ADK session state under
        // `mcp_app_context.{server_id}.{tool_name}` after passing the
        // 7 access gates. Empty {} ack is the spec-compliant return
        // shape — failures are logged but never propagated to the
        // iframe (graceful degradation: agent stays blind to iframe
        // state, but the iframe keeps working).
        if (request.method !== "ui/update-model-context") {
          return {};
        }
        const p = (request.params ?? {}) as {
          structuredContent?: Record<string, unknown>;
          content?: unknown[];
        };
        // Surface the raw push to any observer FIRST, before the sessionId
        // gate. This is the channel standard-only widgets (the AIPLA sims)
        // use for "the user just dragged a slider" — /dev/* pages log it here
        // even though they have no session to POST to.
        onModelContextUpdate?.({
          serverId,
          toolName: unprefixedName,
          structuredContent: p.structuredContent ?? null,
          content: p.content ?? null,
        });
        if (!sessionId) {
          // Pre-first-turn render or /dev/* surface — nothing to POST to.
          return {};
        }
        // TRUST-UI: optimistically show what the assistant is about to
        // receive, then flip to a confirmation. Mirrors A2UISurfaceMount's
        // action-trust strip. Cleared on 403 (skill not opted in) so opt-out
        // skills keep the pre-trust silent behaviour.
        const summary = summarizeStructuredContent(p.structuredContent);
        if (showContextTrust) setContextTrust({ summary, status: "sending" });
        try {
          const res = await fetchWithAuth(
            `/api/proxy/api/sessions/${encodeURIComponent(sessionId)}/iframe-context`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                serverId,
                toolName: unprefixedName,
                structuredContent: p.structuredContent ?? null,
                content: p.content ?? null,
              }),
            },
          );
          if (showContextTrust) {
            if (res.ok) {
              setContextTrust({ summary, status: "sent" });
            } else if (res.status === 403) {
              // Skill hasn't opted into allow_context_writes — the push went
              // nowhere; drop the strip rather than claim it was received.
              setContextTrust(null);
            } else {
              setContextTrust({ summary, status: "error" });
            }
          }
          if (!res.ok && process.env.NODE_ENV !== "production") {
            console.info(
              `MCPAppToolCallRouter: update-model-context POST returned ${res.status}`,
            );
          }
        } catch (err) {
          if (showContextTrust) setContextTrust({ summary, status: "error" });
          console.warn(
            "MCPAppToolCallRouter: update-model-context POST failed",
            err,
          );
        }
        return {};
      }}
      onError={(err: Error) => {
        console.warn("MCPAppToolCallRouter: AppRenderer error", err);
      }}
    />
  );

  // TRUST-UI: the "receipt" for a ui/update-model-context push. Renders only
  // once a write has fired on the chat path (contextTrust is set nowhere else),
  // so /dev surfaces and opt-out skills never show it. aria-live announces the
  // sending → sent transition without stealing focus.
  const trustStrip =
    showContextTrust && contextTrust ? (
      <div
        role="status"
        aria-live="polite"
        data-testid="mcp-context-trust"
        data-trust-status={contextTrust.status}
        className="mt-2 rounded-md border bg-muted/40 px-3 py-2 text-xs"
      >
        <div className="flex items-center gap-2 font-medium">
          {contextTrust.status === "sending" && (
            <>
              <svg
                className="h-3 w-3 animate-spin text-muted-foreground"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              <span>Sending to the assistant…</span>
            </>
          )}
          {contextTrust.status === "sent" && (
            <>
              <span aria-hidden="true" className="text-green-600">
                ✓
              </span>
              <span>Sent to the assistant</span>
            </>
          )}
          {contextTrust.status === "error" && (
            <>
              <span aria-hidden="true" className="text-amber-600">
                !
              </span>
              <span>Couldn&apos;t reach the assistant</span>
            </>
          )}
        </div>
        <div className="mt-1 text-muted-foreground">
          It receives{" "}
          <code className="rounded bg-background px-1 py-0.5 font-mono text-foreground">
            {contextTrust.summary || "(context)"}
          </code>
        </div>
        {contextTrust.status === "sent" && (
          <p className="mt-1 text-muted-foreground">
            Read on your next message — try asking “what am I looking at?”
          </p>
        )}
      </div>
    ) : null;

  // Sprint 2.13 — warn variant: wrap the AppRenderer with the yellow
  // stripe. The artefact still mounts; the stripe is informational.
  if (decision.action === "warn") {
    return (
      <>
        <ArtefactWarningStripe
          message={decision.message}
          reasonCode={decision.reasonCode}
        >
          {renderedApp}
        </ArtefactWarningStripe>
        {trustStrip}
      </>
    );
  }

  // approve path — unchanged from pre-2.13 behaviour, plus the trust receipt.
  return (
    <>
      {renderedApp}
      {trustStrip}
    </>
  );
}
