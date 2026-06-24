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
// useLayoutEffect (not useEffect) for registration — completes before
// paint, so a dispatch arriving in the same tick the mount layouts
// already finds the surface in the registry.

"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
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
}

export function A2UISurfaceMount({
  surfaceId,
  policy,
  className,
  sessionId,
  skillId,
  triggerOnAction = false,
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
        }
        return;
      }

      // Default (current behaviour): fire-and-forget POST to the plain
      // surface-action endpoint. Backend persists the action under
      // `a2ui_surface_context.{surfaceId}.lastAction`; the agent reads
      // it on the next chat turn.
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
        if (process.env.NODE_ENV !== "production") {
          console.warn(
            `[A2UISurfaceMount] surface-action POST failed for surface "${surfaceId}":`,
            err,
          );
        }
      }
    });
    return () => sub.unsubscribe();
  }, [state?.surface, surfaceId, sessionId, triggerOnAction, triggerAction, skillId]);

  return (
    <div ref={ref} className={className} data-surface={surfaceId}>
      {state?.surface && <A2uiSurface surface={state.surface} />}
    </div>
  );
}
