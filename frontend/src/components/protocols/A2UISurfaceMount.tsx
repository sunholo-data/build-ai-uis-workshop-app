// MULTI-SURFACE-A2UI — A2UISurfaceMount (v0.9 native)
//
// Renders a named A2UI surface using the SurfaceModel that the
// SurfaceRegistry keeps for `surfaceId`. The registry's per-surface
// MessageProcessor owns the model lifecycle; this component is a thin
// render of `<A2uiSurface>` plus mount registration so the dispatcher
// knows the surface exists in the DOM.
//
// Sprint 2.10 (sibling of MCP Apps' ui/update-model-context):
// subscribes to `surface.onAction` and POSTs the A2uiClientAction to
// `/api/sessions/{id}/surface-action`. The backend writes the action
// into ADK session state under
// `a2ui_surface_context.{surfaceId}.lastAction`, where the
// InstructionProvider reads it on the next agent turn. The action
// loop is OPTIONAL per skill — backend gates require
// `tool_configs.a2ui.allow_surface_context_writes: true`; without it
// the POST returns 403 and we drop silently (logged in dev).
//
// ACTION-TRIGGER M2 (sprint 1.21): opt-in `triggerOnAction` prop swaps
// the fire-and-forget POST above for the bundled write+run endpoint
// (`useActionDrivenAgent`), which both persists the action AND runs an
// agent turn that can emit a new A2UI surface in response. Default
// `false` — existing skills (and chat-driven A2UI) keep their current
// behaviour exactly.
//
// TRUST-UI (2026-07): on the default fire-and-forget path the click is
// invisible — it writes `lastAction` into session state that the agent
// only reads on its NEXT chat turn, so from the user's chair "click
// Submit" produces nothing. `showActionTrust` (default `true`) renders a
// small status strip that (1) echoes the exact payload the assistant is
// about to receive — what leaves the client, in plain sight — and (2)
// flips to a confirmation once the write lands, pointing the user at the
// next-turn read. This is the discrete-action sibling of the "Working…"
// overlay the triggerOnAction path already shows; the two never render
// together (the overlay path returns before reaching the POST branch).
//
// useLayoutEffect (not useEffect) for registration — completes before
// paint, so a dispatch arriving in the same tick the mount layouts
// already finds the surface in the registry.

"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { A2uiSurface } from "@a2ui/react/v0_9";
import { fetchWithAuth } from "@/lib/apiClient";
import { useActionDrivenAgent } from "@/hooks/useActionDrivenAgent";
import {
  type SurfacePolicy,
  useSurfaceRegistry,
  useSurfaceState,
} from "@/providers/SurfaceRegistry";

export interface A2UISurfaceMountProps {
  surfaceId: string;
  /** Override individual policy fields; merged onto the default for `surfaceId`. */
  policy?: Partial<SurfacePolicy>;
  /** Tailwind / layout classes for the mount's outer div. */
  className?: string;
  /**
   * Current chat session id. Required for the sprint-2.10 action POST
   * (the endpoint URL embeds it). When `null` (no session yet — fresh
   * chat before first send), action dispatch is skipped — there's
   * nowhere to write the namespaced state. The frontend's snapshot
   * push path still works through `forwardedProps`.
   */
  sessionId?: string | null;
  /**
   * Skill id — required when `triggerOnAction` is `true`, because the
   * action-triggered-run endpoint is scoped to the skill. Ignored when
   * `triggerOnAction` is false (default), so the existing chat-driven
   * surface mounts in `<ChatShell>` don't need to thread it.
   */
  skillId?: string;
  /**
   * ACTION-TRIGGER M2 (sprint 1.21). Default `false` preserves the
   * current fire-and-forget `surface-action` POST behaviour. When
   * `true`, the click drives a full agent turn via
   * `useActionDrivenAgent` instead — the action is persisted server-side
   * (same `EventActions(state_delta)` write) AND the agent runs and
   * streams AG-UI events that can update the rendered surface. The
   * caller is expected to have set `tool_configs.a2ui.allow_action_triggered_runs:
   * true` on the skill (the backend returns 403 otherwise and the
   * surface stays in its last-rendered state).
   */
  triggerOnAction?: boolean;
  /**
   * TRUST-UI (2026-07). When `true` (default), the default fire-and-forget
   * action path renders a status strip below the surface that echoes the
   * payload being handed to the assistant and confirms the write landed —
   * so a click that only surfaces on the agent's next turn isn't invisible
   * in the meantime. No-op when `triggerOnAction` is `true` (that path has
   * its own "Working…" overlay) or when no action ever fires (read-only
   * surfaces). Set `false` to suppress the strip for a fork that wants the
   * original silent behaviour.
   */
  showActionTrust?: boolean;
}

/** TRUST-UI: lifecycle of the payload the assistant is about to receive. */
type TrustStatus = "sending" | "sent" | "error";
interface TrustState {
  name: string;
  context: Record<string, unknown>;
  status: TrustStatus;
}

/**
 * Render an A2UI action's context as a compact `key: value` line for the
 * trust strip. Values are already path-resolved by the binder before
 * dispatch (`{path: "/formInput"}` → the typed string), so this shows the
 * literal data the agent will read — not a binding reference.
 */
function summarizeContext(context: Record<string, unknown>): string {
  return Object.entries(context ?? {})
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(", ");
}

export function A2UISurfaceMount({
  surfaceId,
  policy,
  className,
  sessionId,
  skillId,
  triggerOnAction = false,
  showActionTrust = true,
}: A2UISurfaceMountProps) {
  const ref = useRef<HTMLDivElement>(null);
  const registry = useSurfaceRegistry();
  const state = useSurfaceState(surfaceId);

  useLayoutEffect(() => {
    registry.register(surfaceId, ref, policy);
    return () => {
      registry.unregister(surfaceId);
    };
  }, [surfaceId, policy, registry]);

  // ACTION-TRIGGER M2: useActionDrivenAgent is always instantiated (hooks
  // must run unconditionally); we just gate which dispatch path the
  // action subscription uses. The hook itself is cheap — it just
  // captures sessionId/skillId/registry refs into a callback. When
  // `triggerOnAction` is false (default), the callback is never invoked.
  // `skillId` may be empty for chat-driven mounts; the action-triggered
  // branch is also gated on `skillId.length > 0` so accidental
  // misconfigurations never POST to a malformed URL.
  const { triggerAction } = useActionDrivenAgent({
    skillId: skillId ?? "",
    sessionId: sessionId ?? "",
  });

  // Click-spam guard. An action-triggered run is a FULL agent turn (LLM
  // call(s) + a re-emitted surface). Without a guard, rapid clicks fire N
  // concurrent surface-action-run POSTs that race N surface updates and
  // multiply rate-limit pressure. We drop clicks while a run is in flight.
  //
  // The guard is a REF so it flips synchronously inside the action callback
  // (state updates are async — a same-tick double-click could slip past a
  // state-only check). But a silent drop reads as a dead button: with no
  // visual change, the user assumes the first click missed and clicks again.
  // So we mirror the ref into `isRunning` state purely for rendering — it
  // drives the "Working…" overlay below that dims the surface and blocks
  // pointer events, making the busy state obvious. Ref = correctness (the
  // real guard), state = feedback (the visible cue). Both flip together.
  const actionInFlightRef = useRef(false);
  const [isRunning, setIsRunning] = useState(false);

  // TRUST-UI: the last action we handed to the assistant on the default
  // path, plus where it is in its lifecycle. Cleared whenever the surface
  // is re-created (clearSurface → new createSurface) so a fresh form never
  // inherits a stale "Sent" strip — the effect below keys on the surface
  // identity, which the registry swaps on every createSurface.
  const [trust, setTrust] = useState<TrustState | null>(null);
  useEffect(() => {
    setTrust(null);
  }, [state?.surface]);

  // Subscribe to surface actions and route each one through the
  // configured dispatch path. Re-subscribes whenever the SurfaceModel
  // identity changes (clearSurface → new createSurface).
  useEffect(() => {
    if (!state?.surface) return;
    if (!sessionId) return;
    const sub = state.surface.onAction.subscribe(async (action) => {
      if (triggerOnAction) {
        // ACTION-TRIGGER M2: skill id is required for the bundled
        // write+run endpoint URL. Drop silently in dev when missing —
        // the design-doc fork that opts in must thread skillId.
        if (!skillId) {
          if (process.env.NODE_ENV !== "production") {
            console.warn(
              `[A2UISurfaceMount] triggerOnAction=true but skillId is missing for surface "${surfaceId}"; skipping`,
            );
          }
          return;
        }
        // Drop the click if a run is already in flight (see actionInFlightRef).
        if (actionInFlightRef.current) {
          if (process.env.NODE_ENV !== "production") {
            console.info(
              `[A2UISurfaceMount] action ignored — a run is already in flight for surface "${surfaceId}"`,
            );
          }
          return;
        }
        actionInFlightRef.current = true;
        setIsRunning(true);
        try {
          await triggerAction(surfaceId, {
            name: action.name,
            sourceComponentId: action.sourceComponentId,
            timestamp: action.timestamp,
            context: action.context,
          });
        } catch (err) {
          // triggerAction rejects only on RUN_ERROR — surface the
          // failure in dev so the workshop demo doesn't fail silently.
          if (process.env.NODE_ENV !== "production") {
            console.warn(
              `[A2UISurfaceMount] action-triggered run failed for surface "${surfaceId}":`,
              err,
            );
          }
        } finally {
          actionInFlightRef.current = false;
          setIsRunning(false);
        }
        return;
      }

      // Default (current behaviour): fire-and-forget POST to the plain
      // surface-action endpoint. Backend persists the action under
      // `a2ui_surface_context.{surfaceId}.lastAction`; the agent reads
      // it on the next chat turn.
      //
      // TRUST-UI: optimistically show the payload the moment the click
      // fires — the write is invisible otherwise (it only shows up on the
      // agent's next turn). We keep `action.name`/`action.context` in a
      // local so the async status flips below reference stable values.
      const trustName = action.name;
      const trustContext = action.context;
      if (showActionTrust) {
        setTrust({ name: trustName, context: trustContext, status: "sending" });
      }
      try {
        const res = await fetchWithAuth(
          `/api/proxy/api/sessions/${encodeURIComponent(sessionId)}/surface-action`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              surfaceId,
              action: {
                name: action.name,
                sourceComponentId: action.sourceComponentId,
                timestamp: action.timestamp,
                context: action.context,
              },
            }),
          },
        );
        if (showActionTrust) {
          if (res.ok) {
            setTrust({
              name: trustName,
              context: trustContext,
              status: "sent",
            });
          } else if (res.status === 403) {
            // Skill hasn't opted into surface writes — the action genuinely
            // goes nowhere. Drop the strip rather than claim it was received;
            // this preserves the pre-trust "silent" UX for opt-out skills.
            setTrust(null);
          } else {
            setTrust({
              name: trustName,
              context: trustContext,
              status: "error",
            });
          }
        }
        if (!res.ok && process.env.NODE_ENV !== "production") {
          // 403 is the expected response when the skill hasn't opted in;
          // we log but don't surface to the user.
          const detail = await res.text().catch(() => "");
          console.info(
            `[A2UISurfaceMount] surface-action POST returned ${res.status} for surface "${surfaceId}"`,
            detail,
          );
        }
      } catch (err) {
        if (showActionTrust) {
          setTrust({ name: trustName, context: trustContext, status: "error" });
        }
        if (process.env.NODE_ENV !== "production") {
          console.warn(
            `[A2UISurfaceMount] surface-action POST failed for surface "${surfaceId}":`,
            err,
          );
        }
      }
    });
    return () => sub.unsubscribe();
  }, [
    state?.surface,
    surfaceId,
    sessionId,
    triggerOnAction,
    triggerAction,
    skillId,
    showActionTrust,
  ]);

  const trustSummary = trust ? summarizeContext(trust.context) : "";

  return (
    <div ref={ref} className={className} data-surface={surfaceId}>
      {state?.surface && (
        <>
          <div className="relative">
            {/* Dim + disable the surface while an action-triggered run is in
              flight. `pointer-events-none` is belt-and-braces on top of the
              ref guard: it stops a stray click reaching the button DOM at all
              (the SDK renders the Button; we can't reach into it to disable
              it, so we gate interaction at the wrapper). */}
            <div
              aria-busy={isRunning}
              className={
                isRunning
                  ? "pointer-events-none opacity-60 transition-opacity"
                  : "transition-opacity"
              }
            >
              <A2uiSurface surface={state.surface} />
            </div>
            {isRunning && (
              <div
                className="pointer-events-none absolute inset-0 flex items-center justify-center"
                role="status"
                aria-live="polite"
                data-testid="a2ui-surface-running"
              >
                <span className="inline-flex items-center gap-2 rounded-full border bg-background/90 px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur-sm">
                  <svg
                    className="h-3 w-3 animate-spin"
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
                  Working…
                </span>
              </div>
            )}
          </div>
          {/* TRUST-UI: the discrete-action "receipt". Renders only once an
            action has fired on the default path (`trust` is set nowhere
            else), so read-only and triggerOnAction surfaces never show it.
            `aria-live="polite"` announces the sending → sent transition to
            assistive tech without stealing focus. */}
          {showActionTrust && trust && (
            <div
              role="status"
              aria-live="polite"
              data-testid="a2ui-action-trust"
              data-trust-status={trust.status}
              className="mt-3 rounded-md border bg-muted/40 px-3 py-2 text-xs"
            >
              <div className="flex items-center gap-2 font-medium">
                {trust.status === "sending" && (
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
                {trust.status === "sent" && (
                  <>
                    <span aria-hidden="true" className="text-green-600">
                      ✓
                    </span>
                    <span>Sent to the assistant</span>
                  </>
                )}
                {trust.status === "error" && (
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
                  {trust.name}
                  {trustSummary ? ` — ${trustSummary}` : ""}
                </code>
              </div>
              {trust.status === "sent" && (
                <p className="mt-1 text-muted-foreground">
                  Read on your next message — try asking “what did I submit?”
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
