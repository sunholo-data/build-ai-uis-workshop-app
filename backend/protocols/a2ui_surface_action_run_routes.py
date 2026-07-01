"""Bundled write-and-run endpoint for A2UI surface actions (ACTION-TRIGGER M1).

Sibling of ``a2ui_surface_action_routes`` — same 7-gate access policy
(reused via ``_a2ui_surface_shared``) plus one extra opt-in gate, plus
synthetic agent invocation that streams AG-UI events back as SSE.

Closes the loop that the original ``surface-action`` endpoint left
open: today, a click persists the action into session state and waits
for the *next chat message* to trigger an agent turn. For Pattern 1
demos (declarative agent-driven UI — no chat composer) that's a
missing rung. This endpoint bundles write + run so a single click
drives a full turn, end-to-end, without any user-typed message.

See ``docs/design/v6.1.0/action-triggered-agent-turn.md`` for the
design rationale, the 8 gates, and the wire contract.

Auth + access boundary (eight gates):
  1-7. Identical to ``surface-action`` (shared via
       ``_a2ui_surface_shared``).
  8.   Skill must explicitly opt in via
       ``tool_configs.a2ui.allow_action_triggered_runs: true``
       (default false). Distinct trust grant from
       ``allow_surface_context_writes`` — a skill can accept action
       writes without being invokable by them.

The synthetic run input:
  * ``thread_id = session_id`` (AG-UI thread-id-as-session-id convention)
  * ``messages = []`` — no user-visible message; ``ADKAgent.run()`` at
    line 840 of the vendored ``ag_ui_adk`` accepts empty messages and
    falls through to ``_start_new_execution``
  * ``state = {"a2ui_action_trigger": {...}, "a2ui_surface_state": {...}}``
    so the wrapped ``wrap_with_a2ui_surface_context`` InstructionProvider
    can prepend the "user just clicked" framing clause
  * ``forwarded_props`` mirrors the same payload (belt-and-braces; the
    vendored library currently only reads ``state`` but the spec puts
    transient signals on ``forwarded_props``)

Responses:
  * 200 — SSE stream of AG-UI events, ``RUN_STARTED`` first, terminal
    ``RUN_FINISHED`` / ``RUN_ERROR`` last (G41 dedup ensures at most
    one terminal event per run)
  * 401/403/404/413 — same shape as ``surface-action``
  * 403 (new) — skill not opted into action-triggered runs
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any

from ag_ui.core import RunAgentInput, UserMessage
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from google.adk.events import Event, EventActions
from pydantic import BaseModel, Field

from adk.agent import _HeuristicRouter, create_agent_with_thinking
from adk.agui import APP_NAME, build_agui_adk_agent, stream_agui_events
from adk.session import get_session_service
from auth import User, get_current_user
from protocols._a2ui_surface_shared import (
    _STATE_KEY_NAMESPACE,
    _enforce_size_cap,
    _enforce_skill_opt_in,
    _require_session,
)
from skills import skill_config

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/skills", tags=["a2ui-surface-action-run"])


class SurfaceActionRunPayload(BaseModel):
    """One A2uiClientAction event — identical schema to ``SurfaceActionPayload``
    in the sibling fire-and-forget endpoint. Kept local rather than imported so
    each route module owns its own wire contract."""

    name: str = Field(min_length=1, max_length=128)
    source_component_id: str | None = Field(default=None, alias="sourceComponentId", max_length=256)
    timestamp: str | None = Field(default=None, max_length=64)
    context: dict[str, Any] | None = Field(default=None)

    model_config = {"populate_by_name": True, "extra": "forbid"}


class SurfaceActionRunRequest(BaseModel):
    """Body of ``POST /api/skills/{skill_id}/sessions/{session_id}/surface-action-run``.

    ``forwardedProps`` carries the frontend's per-turn surface snapshot
    (``a2ui_surface_state``) in the same shape the chat-driven endpoint
    accepts — keeps both ends symmetrical with chat turns.
    """

    surface_id: str = Field(alias="surfaceId", min_length=1, max_length=128)
    action: SurfaceActionRunPayload
    forwarded_props: dict[str, Any] | None = Field(default=None, alias="forwardedProps")

    model_config = {"populate_by_name": True, "extra": "forbid"}


def _enforce_action_triggered_opt_in(skill_id: str, user: User) -> None:
    """Gate 8: ``tool_configs.a2ui.allow_action_triggered_runs: true``.

    Distinct trust grant from ``allow_surface_context_writes``. The
    earlier gate (#6) says "this skill accepts surface clicks pushing
    data into context"; this gate says "this skill is *driven* by
    surface clicks". A skill can opt into one without the other —
    forks that want surface-context writes for prompt enrichment but
    keep their agent invocation gated to chat turns leave this off.

    Raises:
        HTTPException(403): when the skill has not opted in.
    """
    skill = skill_config.get_skill(skill_id)
    # The earlier shared gates already proved skill exists; defensive
    # repeat-check guards against a delete-between-gates race.
    if skill is None:
        log.info(
            "surface_action_run: skill disappeared between gates uid=%s skill_id=%s",
            user.uid,
            skill_id,
        )
        raise HTTPException(status_code=403, detail="Access denied")

    a2ui_config = (skill.skill_metadata.tool_configs or {}).get("a2ui") or {}
    if not a2ui_config.get("allow_action_triggered_runs"):
        log.info(
            "surface_action_run: skill not opted into action-triggered runs uid=%s skill_id=%s",
            user.uid,
            skill_id,
        )
        raise HTTPException(
            status_code=403,
            detail="Skill not opted into action-triggered runs",
        )


def _resolve_agent(skill_id: str, user: User):
    """Build the ADK agent for ``skill_id`` and pick a single agent if
    the skill uses the heuristic-router thinking strategy.

    The router picks between fast/thinking on the user's *message*;
    action-triggered runs have no message, so we always pick the fast
    agent (matches "no thinking required" semantics — the surface click
    is structured, not a free-form question).

    Returns:
        A built ``LlmAgent`` ready for ``build_agui_adk_agent`` to wrap.
    """
    skill = skill_config.get_skill(skill_id)
    if skill is None:
        # Should be unreachable because the shared opt-in gate proves
        # existence; defensive 403 keeps the error shape consistent.
        raise HTTPException(status_code=403, detail="Access denied")
    agent_or_router = create_agent_with_thinking(skill, user)
    if isinstance(agent_or_router, _HeuristicRouter):
        return agent_or_router.fast
    return agent_or_router


async def _write_action_to_state(
    session_id: str,
    user: User,
    skill_id: str,
    body: SurfaceActionRunRequest,
    size_bytes: str,
) -> None:
    """Persist the action under ``a2ui_surface_context.{surfaceId}.lastAction``
    via the same ``EventActions(state_delta=...)`` pattern the original
    fire-and-forget endpoint uses. ADK sessions are keyed by
    ``(APP_NAME, user_id, session_id)``."""
    session_service = get_session_service()
    session = await session_service.get_session(
        app_name=APP_NAME,
        user_id=user.uid,
        session_id=session_id,
    )
    if session is None:
        # Robustness: the frontend bootstraps the session on mount, but a click
        # can still race the bootstrap or hit a fresh backend (LOCAL_MODE
        # sessions are in-memory and reset on every restart). Auto-create on
        # demand rather than 404 — an action run is meaningless without a
        # session, and create_session is idempotent for the same id.
        log.info(
            "surface_action_run: ADK session missing — auto-creating uid=%s session_id=%s skill_id=%s",
            user.uid,
            session_id,
            skill_id,
        )
        session = await session_service.create_session(
            app_name=APP_NAME,
            user_id=user.uid,
            session_id=session_id,
        )

    state_key = f"{_STATE_KEY_NAMESPACE}.{body.surface_id}.lastAction"
    state_value: dict[str, Any] = {
        "name": body.action.name,
        "_pushedAt": time.time(),
    }
    if body.action.source_component_id:
        state_value["sourceComponentId"] = body.action.source_component_id
    if body.action.context is not None:
        state_value["context"] = body.action.context
    if body.action.timestamp:
        state_value["timestamp"] = body.action.timestamp

    actions = EventActions(state_delta={state_key: state_value})
    event = Event(
        invocation_id=f"surface_action_run_{int(time.time() * 1000)}",
        author="user",
        actions=actions,
        timestamp=time.time(),
    )
    await session_service.append_event(session, event)

    log.info(
        "surface_action_run: write uid=%s session=%s skill=%s surface=%s action=%s bytes=%s",
        user.uid,
        session_id,
        skill_id,
        body.surface_id,
        body.action.name,
        size_bytes,
    )


def _build_run_input(session_id: str, body: SurfaceActionRunRequest) -> RunAgentInput:
    """Synthesize a ``RunAgentInput`` with a single synthetic user turn, the
    action trigger seeded into ``state`` (where ``wrap_with_a2ui_surface_context``
    reads it from), and the same payload mirrored into ``forwarded_props``.

    ADK's runner requires a non-empty ``new_message`` (or an ``invocation_id``)
    to start a turn — an empty ``messages`` list raises BACKGROUND_EXECUTION_ERROR
    on the installed ag_ui_adk/ADK. The trigger itself travels via ``state``; the
    synthetic message just gives ADK something to run.
    """
    surface_snapshot = (body.forwarded_props or {}).get("a2ui_surface_state")
    surface_state: dict[str, Any] = surface_snapshot if isinstance(surface_snapshot, dict) else {}

    action_trigger: dict[str, Any] = {
        "surfaceId": body.surface_id,
        "componentId": body.action.source_component_id,
        "name": body.action.name,
    }

    initial_state: dict[str, Any] = {
        # Read by wrap_with_a2ui_surface_context — emits the
        # "Action-triggered turn" framing clause to the model.
        "a2ui_action_trigger": action_trigger,
    }
    if surface_state:
        initial_state["a2ui_surface_state"] = surface_state

    # Mirror onto forwarded_props too. ag_ui_adk currently only reads
    # state (forwarded_props is passthrough), but the protocol-spec
    # placement is forwardedProps for transient per-turn signals; keep
    # both populated so future ag_ui_adk versions or downstream tooling
    # can read whichever they prefer.
    forwarded_props: dict[str, Any] = {
        "_action_trigger": action_trigger,
    }
    if surface_state:
        forwarded_props["a2ui_surface_state"] = surface_state

    return RunAgentInput(
        threadId=session_id,
        runId=f"action_trigger_{int(time.time() * 1000)}",
        state=initial_state,
        messages=[
            UserMessage(
                id=f"action_{int(time.time() * 1000)}",
                role="user",
                content=(
                    f"(The user triggered the '{body.action.name}' action on the "
                    "interactive UI surface. Respond by updating the surface.)"
                ),
            )
        ],
        tools=[],
        context=[],
        forwardedProps=forwarded_props,
    )


@router.post("/{skill_id}/sessions/{session_id}/surface-action-run")
async def post_surface_action_run(
    skill_id: str,
    session_id: str,
    body: SurfaceActionRunRequest,
    request: Request,
    user: User = Depends(get_current_user),  # noqa: B008
) -> StreamingResponse:
    """Receive an A2UI surface action, persist it, and invoke the agent
    immediately — streaming AG-UI events back as ``text/event-stream``.

    The 8 gates (Firebase JWT, session exists, session access, skill
    exists, skill has a2ui config, allow_surface_context_writes,
    size cap, allow_action_triggered_runs) all fire BEFORE the
    StreamingResponse opens — failures surface as proper HTTP errors,
    not as half-open SSE streams.

    See module docstring for the gate matrix and run-input shape.
    """
    # Gate 2: session exists
    idx = _require_session(session_id)

    # Gate 3: caller can access the session
    ctx = request.state.access
    if not ctx.can_access(idx):
        log.info(
            "surface_action_run: access denied uid=%s session_id=%s skill_id=%s",
            user.uid,
            session_id,
            idx.skill_id,
        )
        raise HTTPException(status_code=403, detail="Access denied")

    # The URL-passed skill_id MUST match the skill backing this session.
    # Without this check, a caller with access to a session under skill A
    # could invoke skill B via a forged URL — bypassing skill-B's own
    # access policy. Keeps the per-skill opt-in honest.
    if idx.skill_id != skill_id:
        log.info(
            "surface_action_run: skill_id mismatch uid=%s session=%s url_skill=%s session_skill=%s",
            user.uid,
            session_id,
            skill_id,
            idx.skill_id,
        )
        raise HTTPException(status_code=403, detail="Access denied")

    # Gates 4 + 5 + 6: skill exists + has a2ui config + opted into context writes
    _enforce_skill_opt_in(skill_id, user)

    # Gate 7: action context size cap
    size_bytes = _enforce_size_cap(body.action.context)

    # Gate 8: per-skill opt-in for action-triggered runs (new)
    _enforce_action_triggered_opt_in(skill_id, user)

    # Persist the action (same write the fire-and-forget endpoint does).
    await _write_action_to_state(session_id, user, skill_id, body, size_bytes)

    # Build the agent + AG-UI bridge, then synthesize an empty-message
    # run input that carries the trigger via state + forwarded_props.
    agent = _resolve_agent(skill_id, user)
    agui_agent = build_agui_adk_agent(agent, user_id=user.uid)
    run_input = _build_run_input(session_id, body)

    async def _sse():
        try:
            async for event in stream_agui_events(agui_agent, run_input):
                yield f"data: {json.dumps(event)}\n\n"
        except Exception as exc:
            # Translate any uncaught exception from the streaming pipeline
            # into a typed AG-UI RUN_ERROR so the client's state machine
            # closes cleanly rather than hanging on a torn connection.
            log.exception(
                "surface_action_run: stream failed uid=%s session=%s skill=%s: %s",
                user.uid,
                session_id,
                skill_id,
                exc,
            )
            err_event = {
                "type": "RUN_ERROR",
                "message": f"Action-triggered run failed: {exc!s}",
                "code": "ACTION_TRIGGER_FAILED",
            }
            yield f"data: {json.dumps(err_event)}\n\n"

    return StreamingResponse(_sse(), media_type="text/event-stream")


__all__ = ["router"]
