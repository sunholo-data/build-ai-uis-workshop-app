"""API tests for ``POST /api/skills/{skill_id}/sessions/{session_id}/surface-action-run`` (ACTION-TRIGGER M1).

Sibling of ``test_a2ui_surface_action_routes.py`` — the new bundled
write-and-run endpoint reuses the same 7-gate access policy via the
shared module, layers gate 8 (``allow_action_triggered_runs``), and on
success streams AG-UI events back as SSE rather than returning 204.

Gates exercised (parity with surface-action):
  1. Firebase JWT required (401)
  2. Session must exist (404)
  3. Caller must access the session (403)
  4. Skill must exist (403)
  5. Skill must have ``tool_configs.a2ui`` (403)
  6. ``allow_surface_context_writes: true`` (403 default-deny)
  7. ``action.context`` ≤ 4 KB serialized (413)

Gate 8 (new):
  * ``allow_action_triggered_runs: true`` (403 default-deny)

Additional assertions:
  * Happy path: 200 + SSE with RUN_STARTED + RUN_FINISHED
  * G41 dedup: at most one terminal event when the agent emits both
  * Synthetic input shape: ``messages=[]``, ``forwardedProps._action_trigger``
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from ag_ui.core import RunAgentInput
from fastapi import FastAPI
from fastapi.testclient import TestClient

from auth import User, get_current_user
from auth.access_context import AccessContext
from db.models import SkillConfig
from db.models.access import AccessControl
from db.models.chat_session import ChatSessionIndex
from protocols.a2ui_surface_action_run_routes import router

# ---------------------------------------------------------------------------
# Test app + auth fixtures (mirror surface-action scaffolding)
# ---------------------------------------------------------------------------

URL = "/api/skills/skill-1/sessions/sess-1/surface-action-run"


def _make_client(uid: str = "viewer", tags: frozenset[str] = frozenset()) -> TestClient:
    user = User(uid=uid, email=f"{uid}@example.com", domain="example.com")
    ctx = AccessContext(uid=uid, email=user.email, domain=user.domain, group_tags=tags)

    test_app = FastAPI()
    test_app.include_router(router)

    @test_app.middleware("http")
    async def _inject_access(request, call_next):
        request.state.access = ctx
        return await call_next(request)

    test_app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(test_app)


def _make_no_auth_client() -> TestClient:
    test_app = FastAPI()
    test_app.include_router(router)
    return TestClient(test_app)


def _make_index(
    session_id: str = "sess-1",
    skill_id: str = "skill-1",
    owner_uid: str = "viewer",
    ac: AccessControl | None = None,
) -> ChatSessionIndex:
    now = datetime.now(UTC)
    return ChatSessionIndex(
        sessionId=session_id,
        documentIds=[],
        skillId=skill_id,
        ownerUid=owner_uid,
        accessControl=ac or AccessControl(type="public"),
        title=None,
        turnCount=0,
        firstMessageAt=now,
        lastMessageAt=now,
        archivedAt=None,
    )


def _make_skill(
    skill_id: str = "skill-1",
    owner_uid: str = "viewer",
    a2ui_config: dict | None = None,
    ac: AccessControl | None = None,
) -> SkillConfig:
    """Build a SkillConfig with ``tool_configs.a2ui`` set."""
    tool_configs: dict = {}
    if a2ui_config is not None:
        tool_configs["a2ui"] = a2ui_config
    return SkillConfig(
        skillId=skill_id,
        name="test-skill",
        description="a test skill",
        ownerId=owner_uid,
        ownerEmail=f"{owner_uid}@example.com",
        accessControl=ac or AccessControl(type="public"),
        skillMetadata={"tools": [], "toolConfigs": tool_configs},
    )


def _mock_session_service() -> MagicMock:
    session = MagicMock()
    session.state = {}
    svc = MagicMock()
    svc.get_session = AsyncMock(return_value=session)
    svc.append_event = AsyncMock()
    return svc


_HAPPY_BODY = {
    "surfaceId": "workspace",
    "action": {
        "name": "approve",
        "sourceComponentId": "row-47",
        "context": {"id": 47, "status": "pending"},
    },
    "forwardedProps": {
        "a2ui_surface_state": {
            "workspace": {"dataModel": {"counter": 3}},
        },
    },
}

# Gates 6 AND 8 both must be flipped on for a happy-path run.
_OPTED_IN_A2UI = {
    "default_surface": "workspace",
    "allow_surface_context_writes": True,
    "allow_action_triggered_runs": True,
}


def _stub_stream(events: list[dict]):
    """Return a coroutine factory that mimics ``stream_agui_events``
    by yielding the supplied list of pre-serialized event dicts."""

    async def _gen(_agui_agent, _run_input) -> AsyncIterator[dict]:
        for ev in events:
            yield ev

    return _gen


def _captured_run_input(mock_stream) -> RunAgentInput:
    """Pull the RunAgentInput the route passed to ``stream_agui_events`` out
    of the call-args record. Lets tests assert wire-shape invariants."""
    assert mock_stream.call_args is not None, "stream_agui_events not called"
    _agui_agent, run_input = mock_stream.call_args.args
    return run_input


def _patches(stream_events: list[dict] | None = None):
    """Common 4-mock context manager for the happy path / opt-in tests.

    Patches the gate dependencies (get_session_index, skill_config),
    the session-service singleton, the agent-build helper, and the
    AG-UI streaming generator. The route's other deps (get_current_user,
    AccessContext) are injected by ``_make_client``.
    """
    if stream_events is None:
        stream_events = [
            {"type": "RUN_STARTED", "thread_id": "sess-1", "run_id": "r1"},
            {"type": "RUN_FINISHED", "thread_id": "sess-1", "run_id": "r1"},
        ]

    return (
        patch("protocols._a2ui_surface_shared.get_session_index"),
        patch("protocols._a2ui_surface_shared.skill_config"),
        patch("protocols.a2ui_surface_action_run_routes.skill_config"),
        patch("protocols.a2ui_surface_action_run_routes.get_session_service"),
        patch("protocols.a2ui_surface_action_run_routes._resolve_agent"),
        patch("protocols.a2ui_surface_action_run_routes.build_agui_adk_agent"),
        patch(
            "protocols.a2ui_surface_action_run_routes.stream_agui_events",
            side_effect=_stub_stream(stream_events),
        ),
    )


def _parse_sse(body: str) -> list[dict]:
    """Parse a ``text/event-stream`` payload into the list of JSON dicts
    that were yielded as ``data:`` lines."""
    events: list[dict] = []
    for raw in body.split("\n\n"):
        line = raw.strip()
        if not line.startswith("data:"):
            continue
        payload = line[len("data:") :].strip()
        if payload:
            events.append(json.loads(payload))
    return events


# ---------------------------------------------------------------------------
# Happy path + synthetic-input shape
# ---------------------------------------------------------------------------


class TestHappyPath:
    def test_returns_200_sse_with_run_started_and_run_finished(self):
        patches = _patches()
        with (
            patches[0] as mock_get_index,
            patches[1] as mock_shared_skill,
            patches[2] as mock_route_skill,
            patches[3] as mock_get_svc,
            patches[4] as mock_resolve,
            patches[5] as mock_build,
            patches[6] as mock_stream,
        ):
            mock_get_index.return_value = _make_index()
            skill = _make_skill(a2ui_config=_OPTED_IN_A2UI)
            mock_shared_skill.get_skill.return_value = skill
            mock_route_skill.get_skill.return_value = skill
            mock_get_svc.return_value = _mock_session_service()
            mock_resolve.return_value = MagicMock(name="fake_agent")
            mock_build.return_value = MagicMock(name="fake_agui_agent")

            client = _make_client("viewer")
            resp = client.post(URL, json=_HAPPY_BODY)

            assert resp.status_code == 200, resp.text
            assert resp.headers["content-type"].startswith("text/event-stream")
            events = _parse_sse(resp.text)
            types = [e.get("type") for e in events]
            assert "RUN_STARTED" in types
            assert "RUN_FINISHED" in types
            assert mock_stream.called

    def test_persists_action_write_under_namespaced_key(self):
        patches = _patches()
        with (
            patches[0] as mock_get_index,
            patches[1] as mock_shared_skill,
            patches[2] as mock_route_skill,
            patches[3] as mock_get_svc,
            patches[4] as mock_resolve,
            patches[5] as mock_build,
            patches[6] as _mock_stream,
        ):
            mock_get_index.return_value = _make_index()
            skill = _make_skill(a2ui_config=_OPTED_IN_A2UI)
            mock_shared_skill.get_skill.return_value = skill
            mock_route_skill.get_skill.return_value = skill
            svc = _mock_session_service()
            mock_get_svc.return_value = svc
            mock_resolve.return_value = MagicMock()
            mock_build.return_value = MagicMock()

            client = _make_client("viewer")
            resp = client.post(URL, json=_HAPPY_BODY)
            assert resp.status_code == 200, resp.text

            svc.append_event.assert_awaited_once()
            event_arg = svc.append_event.await_args.args[1]
            delta = event_arg.actions.state_delta
            assert "a2ui_surface_context.workspace.lastAction" in delta
            written = delta["a2ui_surface_context.workspace.lastAction"]
            assert written["name"] == "approve"
            assert written["sourceComponentId"] == "row-47"
            assert written["context"] == {"id": 47, "status": "pending"}

    def test_synthetic_input_has_empty_messages_and_action_trigger(self):
        """The new endpoint MUST synthesize a RunAgentInput with no
        user-visible message and the click metadata threaded through
        both ``state`` (so the InstructionProvider sees it) and
        ``forwarded_props`` (the protocol-canonical location for
        per-turn signals). This is the contract the design doc
        promised — verify the wire shape directly."""
        patches = _patches()
        with (
            patches[0] as mock_get_index,
            patches[1] as mock_shared_skill,
            patches[2] as mock_route_skill,
            patches[3] as mock_get_svc,
            patches[4] as mock_resolve,
            patches[5] as mock_build,
            patches[6] as mock_stream,
        ):
            mock_get_index.return_value = _make_index()
            skill = _make_skill(a2ui_config=_OPTED_IN_A2UI)
            mock_shared_skill.get_skill.return_value = skill
            mock_route_skill.get_skill.return_value = skill
            mock_get_svc.return_value = _mock_session_service()
            mock_resolve.return_value = MagicMock()
            mock_build.return_value = MagicMock()

            client = _make_client("viewer")
            resp = client.post(URL, json=_HAPPY_BODY)
            assert resp.status_code == 200, resp.text

            run_input = _captured_run_input(mock_stream)
            # No user message
            assert run_input.messages == []
            # thread_id = session_id (AG-UI convention)
            assert run_input.thread_id == "sess-1"
            # Action trigger threaded through forwarded_props
            assert run_input.forwarded_props is not None
            assert "_action_trigger" in run_input.forwarded_props
            trig = run_input.forwarded_props["_action_trigger"]
            assert trig["surfaceId"] == "workspace"
            assert trig["componentId"] == "row-47"
            assert trig["name"] == "approve"
            # Surface snapshot threaded through state for the InstructionProvider
            assert "a2ui_action_trigger" in run_input.state
            assert run_input.state["a2ui_action_trigger"]["name"] == "approve"
            assert "a2ui_surface_state" in run_input.state


# ---------------------------------------------------------------------------
# Gate 1 — Firebase JWT
# ---------------------------------------------------------------------------


class TestAuthGate:
    def test_rejects_when_unauthenticated(self):
        client = _make_no_auth_client()
        resp = client.post(URL, json=_HAPPY_BODY)
        assert resp.status_code in (401, 403, 422)


# ---------------------------------------------------------------------------
# Gate 2 — session must exist
# ---------------------------------------------------------------------------


class TestSessionGate:
    @patch("protocols._a2ui_surface_shared.get_session_index")
    def test_returns_404_when_session_unknown(self, mock_get_index):
        mock_get_index.return_value = None
        client = _make_client("viewer")
        resp = client.post(URL, json=_HAPPY_BODY)
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Gate 3 — caller must access the session
# ---------------------------------------------------------------------------


class TestAccessGate:
    @patch("protocols._a2ui_surface_shared.get_session_index")
    def test_returns_403_when_no_session_access(self, mock_get_index):
        mock_get_index.return_value = _make_index(
            owner_uid="someone-else",
            ac=AccessControl(type="private"),
        )
        client = _make_client("viewer")
        resp = client.post(URL, json=_HAPPY_BODY)
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Gates 4 + 5 + 6 — skill existence, a2ui config, allow_surface_context_writes
# ---------------------------------------------------------------------------


class TestSkillAndOptInGates:
    @patch("protocols._a2ui_surface_shared.skill_config")
    @patch("protocols._a2ui_surface_shared.get_session_index")
    def test_returns_403_when_skill_deleted(self, mock_get_index, mock_skill_module):
        mock_get_index.return_value = _make_index()
        mock_skill_module.get_skill.return_value = None
        client = _make_client("viewer")
        resp = client.post(URL, json=_HAPPY_BODY)
        assert resp.status_code == 403

    @patch("protocols._a2ui_surface_shared.skill_config")
    @patch("protocols._a2ui_surface_shared.get_session_index")
    def test_returns_403_when_skill_has_no_a2ui_config(self, mock_get_index, mock_skill_module):
        mock_get_index.return_value = _make_index()
        mock_skill_module.get_skill.return_value = _make_skill()  # no a2ui
        client = _make_client("viewer")
        resp = client.post(URL, json=_HAPPY_BODY)
        assert resp.status_code == 403
        assert "A2UI tool_config" in resp.text

    @patch("protocols._a2ui_surface_shared.skill_config")
    @patch("protocols._a2ui_surface_shared.get_session_index")
    def test_returns_403_when_allow_surface_context_writes_false(self, mock_get_index, mock_skill_module):
        """Gate 6 still gates the new endpoint — even with
        allow_action_triggered_runs=true the surface-context-write
        flag must also be on, because the endpoint DOES write the
        action into context as part of its work."""
        mock_get_index.return_value = _make_index()
        mock_skill_module.get_skill.return_value = _make_skill(
            a2ui_config={
                "default_surface": "workspace",
                "allow_action_triggered_runs": True,
                # allow_surface_context_writes intentionally missing
            },
        )
        client = _make_client("viewer")
        resp = client.post(URL, json=_HAPPY_BODY)
        assert resp.status_code == 403
        assert "allow_surface_context_writes" in resp.text


# ---------------------------------------------------------------------------
# Gate 7 — size cap
# ---------------------------------------------------------------------------


class TestSizeCapGate:
    @patch("protocols._a2ui_surface_shared.skill_config")
    @patch("protocols._a2ui_surface_shared.get_session_index")
    def test_returns_413_when_context_oversized(self, mock_get_index, mock_skill_module):
        mock_get_index.return_value = _make_index()
        mock_skill_module.get_skill.return_value = _make_skill(a2ui_config=_OPTED_IN_A2UI)
        big_payload = {"data": "x" * 5000}
        client = _make_client("viewer")
        resp = client.post(
            URL,
            json={
                "surfaceId": "workspace",
                "action": {"name": "click", "context": big_payload},
            },
        )
        assert resp.status_code == 413


# ---------------------------------------------------------------------------
# Gate 8 — NEW per-skill opt-in for action-triggered runs
# ---------------------------------------------------------------------------


class TestActionTriggeredOptInGate:
    @patch("protocols.a2ui_surface_action_run_routes.skill_config")
    @patch("protocols._a2ui_surface_shared.skill_config")
    @patch("protocols._a2ui_surface_shared.get_session_index")
    def test_returns_403_when_allow_action_triggered_runs_absent(
        self, mock_get_index, mock_shared_skill, mock_route_skill
    ):
        """Skill opted into surface-context writes but NOT into
        action-triggered runs — gate 8 still rejects.
        Distinct trust grants by design."""
        mock_get_index.return_value = _make_index()
        skill = _make_skill(
            a2ui_config={
                "default_surface": "workspace",
                "allow_surface_context_writes": True,
                # allow_action_triggered_runs intentionally missing
            },
        )
        mock_shared_skill.get_skill.return_value = skill
        mock_route_skill.get_skill.return_value = skill

        client = _make_client("viewer")
        resp = client.post(URL, json=_HAPPY_BODY)
        assert resp.status_code == 403
        assert "action-triggered" in resp.text.lower()

    @patch("protocols.a2ui_surface_action_run_routes.skill_config")
    @patch("protocols._a2ui_surface_shared.skill_config")
    @patch("protocols._a2ui_surface_shared.get_session_index")
    def test_returns_403_when_allow_action_triggered_runs_false_explicit(
        self, mock_get_index, mock_shared_skill, mock_route_skill
    ):
        """Explicit ``false`` (not just absent) is also rejected."""
        mock_get_index.return_value = _make_index()
        skill = _make_skill(
            a2ui_config={
                "default_surface": "workspace",
                "allow_surface_context_writes": True,
                "allow_action_triggered_runs": False,
            },
        )
        mock_shared_skill.get_skill.return_value = skill
        mock_route_skill.get_skill.return_value = skill

        client = _make_client("viewer")
        resp = client.post(URL, json=_HAPPY_BODY)
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# G41 dedup — terminal event uniqueness across the new endpoint
# ---------------------------------------------------------------------------


class TestG41Dedup:
    def test_dedup_keeps_only_one_terminal_event(self):
        """When ``stream_agui_events`` (which the endpoint reuses)
        encounters both RUN_ERROR and RUN_FINISHED in the same run,
        the SSE response must contain exactly one terminal event.
        Reuses the G41 wrapper inside ``stream_agui_events``."""
        # Drive the REAL stream_agui_events with a fake agui_agent
        # whose ``run()`` yields both terminal types in sequence.
        from ag_ui.core import EventType, RunErrorEvent, RunFinishedEvent

        class _FakeAguiAgent:
            async def run(self, _input):
                yield RunErrorEvent(
                    type=EventType.RUN_ERROR,
                    message="boom",
                )
                yield RunFinishedEvent(
                    type=EventType.RUN_FINISHED,
                    thread_id="sess-1",
                    run_id="r1",
                )

        patches = (
            patch("protocols._a2ui_surface_shared.get_session_index"),
            patch("protocols._a2ui_surface_shared.skill_config"),
            patch("protocols.a2ui_surface_action_run_routes.skill_config"),
            patch("protocols.a2ui_surface_action_run_routes.get_session_service"),
            patch("protocols.a2ui_surface_action_run_routes._resolve_agent"),
            patch(
                "protocols.a2ui_surface_action_run_routes.build_agui_adk_agent",
                return_value=_FakeAguiAgent(),
            ),
        )
        with (
            patches[0] as mock_get_index,
            patches[1] as mock_shared_skill,
            patches[2] as mock_route_skill,
            patches[3] as mock_get_svc,
            patches[4] as mock_resolve,
            patches[5] as _mock_build,
        ):
            mock_get_index.return_value = _make_index()
            skill = _make_skill(a2ui_config=_OPTED_IN_A2UI)
            mock_shared_skill.get_skill.return_value = skill
            mock_route_skill.get_skill.return_value = skill
            mock_get_svc.return_value = _mock_session_service()
            mock_resolve.return_value = MagicMock()

            client = _make_client("viewer")
            resp = client.post(URL, json=_HAPPY_BODY)
            assert resp.status_code == 200, resp.text

            events = _parse_sse(resp.text)
            terminal_count = sum(1 for e in events if e.get("type") in ("RUN_ERROR", "RUN_FINISHED"))
            assert terminal_count == 1, f"expected exactly one terminal event, got: {events}"


# ---------------------------------------------------------------------------
# Schema validation
# ---------------------------------------------------------------------------


class TestSchemaValidation:
    def test_returns_422_when_surface_id_missing(self):
        client = _make_client("viewer")
        resp = client.post(URL, json={"action": {"name": "click"}})
        assert resp.status_code == 422

    def test_returns_422_when_action_name_missing(self):
        client = _make_client("viewer")
        resp = client.post(URL, json={"surfaceId": "workspace", "action": {}})
        assert resp.status_code == 422

    def test_returns_422_when_unknown_field_present(self):
        client = _make_client("viewer")
        resp = client.post(
            URL,
            json={
                "surfaceId": "workspace",
                "action": {"name": "click"},
                "evilExtraField": "anything",
            },
        )
        assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Skill ID mismatch (URL skill must match session's skill)
# ---------------------------------------------------------------------------


class TestSkillIdMismatch:
    @patch("protocols._a2ui_surface_shared.get_session_index")
    def test_returns_403_when_url_skill_id_does_not_match_session_skill(self, mock_get_index):
        """The URL-supplied skill_id must match the skill the session
        was created under. Otherwise a caller with access to a session
        under skill A could invoke skill B by forging the URL."""
        mock_get_index.return_value = _make_index(skill_id="different-skill")
        client = _make_client("viewer")
        resp = client.post(URL, json=_HAPPY_BODY)
        assert resp.status_code == 403


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
