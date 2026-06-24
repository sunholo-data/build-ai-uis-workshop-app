// ACTION-TRIGGER M2 — useActionDrivenAgent
//
// Pattern 1 closing rung. The user clicks an A2UI button → this hook POSTs to
// `/api/skills/{skillId}/sessions/{sessionId}/surface-action-run` with the
// A2uiClientAction body + a snapshot of the live A2UI surface state, then
// consumes the AG-UI SSE response and dispatches the resulting A2UI tool
// calls into the same `SurfaceRegistry` the chat path uses. Result: the
// surface re-renders exactly like it would after a chat turn — but no chat
// message was sent.
//
// Why the hook parses SSE itself instead of routing through `HttpAgent`:
// the @ag-ui/client `HttpAgent` is wired to ONE URL (the chat stream
// endpoint) and updates ONE agent's `messages`/`state` arrays. The
// action-triggered endpoint is a different URL and we explicitly do NOT
// want to write a fake chat message into the agent's `messages` array
// (that would render a stray bubble in the chat). The only thing the
// SurfaceRegistry actually needs is the `send_a2ui_json_to_client` tool
// call's `TOOL_CALL_RESULT.content`, which we parse here and feed to
// `registry.appendMessages` — the same call the chat-bubble
// `A2UISurfaceDispatcher` makes. Single point of dispatch into the
// registry; this hook just feeds it through a different ingress.
//
// Graceful HTTP 4xx fallback: when the backend gate rejects (skill not
// opted into `allow_action_triggered_runs`, missing JWT, etc.), the
// promise resolves cleanly with a `console.warn`. The surface stays in
// its last-rendered state — no broken loading spinner, no thrown error
// bubbling into React's error boundary.

"use client";

import { useCallback } from "react";
import { fetchWithAuth } from "@/lib/apiClient";
import { useSurfaceRegistry } from "@/providers/SurfaceRegistry";

/** A2uiClientAction shape — mirrors the backend request schema. */
export interface ActionDrivenAgentAction {
  name: string;
  sourceComponentId?: string;
  timestamp?: string;
  context?: Record<string, unknown>;
}

export interface UseActionDrivenAgentArgs {
  /** Skill id — used in the endpoint URL. */
  skillId: string;
  /** Session id — also used in the endpoint URL. */
  sessionId: string;
}

export interface UseActionDrivenAgentReturn {
  /**
   * POST the action to `surface-action-run`, consume the SSE stream, and
   * dispatch A2UI updates into the SurfaceRegistry. Resolves on
   * `RUN_FINISHED`; rejects on `RUN_ERROR`. Resolves cleanly (no throw)
   * on HTTP 4xx — the skill is not opted in and the surface stays put.
   */
  triggerAction: (
    surfaceId: string,
    action: ActionDrivenAgentAction,
  ) => Promise<void>;
}

const A2UI_TOOL_NAME = "send_a2ui_json_to_client";

interface PendingToolCall {
  name: string;
  args: string;
}

interface ParsedA2uiToolResult {
  surfaceId: string;
  messages: Record<string, unknown>[];
}

/**
 * Parse the `send_a2ui_json_to_client` tool result envelope. Matches the
 * shape produced by `backend/adk/a2ui.py::SurfaceAwareA2uiToolset` (and
 * what `MessageBubble.parseA2UIResult` expects).
 */
function parseA2uiToolResult(
  content: string,
  fallbackSurfaceId: string,
): ParsedA2uiToolResult | null {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const raw = parsed.validated_a2ui_json;
    if (raw === undefined || raw === null) return null;
    const messages = Array.isArray(raw)
      ? (raw as Record<string, unknown>[])
      : [raw as Record<string, unknown>];
    if (messages.length === 0) return null;
    const surfaceId =
      typeof parsed.surface_id === "string" && parsed.surface_id.length > 0
        ? parsed.surface_id
        : fallbackSurfaceId;
    return { surfaceId, messages };
  } catch {
    return null;
  }
}

/**
 * Consume an SSE stream from `body` and yield each parsed `data:` JSON
 * payload. Stops on stream end. Splits on `\n\n` per the SSE spec; only
 * `data:` lines are emitted (comments / event-name lines are ignored —
 * the backend's `stream_agui_events` doesn't emit them but be defensive).
 */
async function* readSSE(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<Record<string, unknown>> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sepIdx = buffer.indexOf("\n\n");
      while (sepIdx !== -1) {
        const frame = buffer.slice(0, sepIdx);
        buffer = buffer.slice(sepIdx + 2);
        const dataLines: string[] = [];
        for (const line of frame.split("\n")) {
          if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trimStart());
          }
        }
        if (dataLines.length > 0) {
          const payload = dataLines.join("\n");
          try {
            yield JSON.parse(payload) as Record<string, unknown>;
          } catch {
            // Malformed frame — backend should never emit one, but if it
            // does, dropping it is safer than killing the stream.
          }
        }
        sepIdx = buffer.indexOf("\n\n");
      }
    }
    // Flush a final frame that wasn't followed by a separator. The
    // backend's `stream_agui_events` always closes with `\n\n` after the
    // terminal event but tolerate the variant.
    const tail = buffer.trim();
    if (tail.length > 0) {
      for (const line of tail.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trimStart();
        try {
          yield JSON.parse(payload) as Record<string, unknown>;
        } catch {
          // ignore
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export function useActionDrivenAgent({
  skillId,
  sessionId,
}: UseActionDrivenAgentArgs): UseActionDrivenAgentReturn {
  const registry = useSurfaceRegistry();

  const triggerAction = useCallback(
    async (
      surfaceId: string,
      action: ActionDrivenAgentAction,
    ): Promise<void> => {
      const url = `/api/proxy/api/skills/${encodeURIComponent(
        skillId,
      )}/sessions/${encodeURIComponent(sessionId)}/surface-action-run`;

      const surfaceSnapshot = registry.readA2uiSurfaceState();
      const body = {
        surfaceId,
        action,
        forwardedProps: { a2ui_surface_state: surfaceSnapshot },
      };

      let res: Response;
      try {
        res = await fetchWithAuth(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch (err) {
        if (process.env.NODE_ENV !== "production") {
          console.warn(
            `[useActionDrivenAgent] network error POSTing to ${url}:`,
            err,
          );
        }
        // Network failure is treated like the 4xx fallback — the surface
        // stays in its last-rendered state, no throw. Consumers can opt
        // into stricter handling by wrapping `triggerAction` themselves.
        return;
      }

      if (!res.ok) {
        // Skill not opted into action-triggered runs (403) or any other
        // gate failure. Design-doc behaviour: console.warn, no throw,
        // surface stays in its last-rendered state.
        console.warn(
          `[useActionDrivenAgent] surface-action-run returned HTTP ${res.status} for ${url}`,
        );
        return;
      }

      if (!res.body) {
        // No stream body — backend contract violation, but resolving
        // cleanly keeps the UI alive.
        if (process.env.NODE_ENV !== "production") {
          console.warn(
            `[useActionDrivenAgent] surface-action-run returned 200 with empty body for ${url}`,
          );
        }
        return;
      }

      // Track in-flight tool calls so we can pair TOOL_CALL_RESULT with
      // the right tool name. G41 dedup on the server guarantees at most
      // one terminal event but we still defend against double-firing on
      // the client by short-circuiting once `terminated` flips.
      const pending = new Map<string, PendingToolCall>();
      let terminated = false;
      let runError: Error | null = null;

      for await (const event of readSSE(res.body)) {
        if (terminated) break;
        const type = event.type;
        if (typeof type !== "string") continue;

        switch (type) {
          case "TOOL_CALL_START": {
            const toolCallId = event.toolCallId;
            const toolCallName = event.toolCallName;
            if (typeof toolCallId !== "string") break;
            if (typeof toolCallName !== "string") break;
            pending.set(toolCallId, { name: toolCallName, args: "" });
            break;
          }
          case "TOOL_CALL_ARGS": {
            const toolCallId = event.toolCallId;
            const delta = event.delta;
            if (typeof toolCallId !== "string") break;
            if (typeof delta !== "string") break;
            const entry = pending.get(toolCallId);
            if (entry) entry.args += delta;
            break;
          }
          case "TOOL_CALL_RESULT": {
            const toolCallId = event.toolCallId;
            const content = event.content;
            if (typeof toolCallId !== "string") break;
            if (typeof content !== "string") break;
            const entry = pending.get(toolCallId);
            if (!entry || entry.name !== A2UI_TOOL_NAME) break;
            const parsed = parseA2uiToolResult(content, surfaceId);
            if (!parsed) break;
            // Dispatch through the same SurfaceRegistry path the chat
            // bubble's A2UISurfaceDispatcher uses. Idempotent on tool
            // call id — strict-mode double-effects are absorbed inside
            // the registry's `consumedToolCallIds` guard.
            registry.appendMessages(
              parsed.surfaceId,
              parsed.messages,
              toolCallId,
            );
            break;
          }
          case "RUN_FINISHED": {
            terminated = true;
            break;
          }
          case "RUN_ERROR": {
            terminated = true;
            const message =
              typeof event.message === "string"
                ? event.message
                : "Agent run failed";
            runError = new Error(message);
            break;
          }
          // Other events (RUN_STARTED, TEXT_MESSAGE_*, STATE_*, CUSTOM,
          // REASONING_*) are accepted but not surfaced — Pattern 1
          // surfaces don't render an inline chat bubble, and surface
          // state is delivered via the tool call above.
          default:
            break;
        }
      }

      if (runError) {
        throw runError;
      }
    },
    [registry, sessionId, skillId],
  );

  return { triggerAction };
}
