"""G41 (template-agui-terminal-dedup.md) — `stream_agui_events` terminal dedup.

The AG-UI spec mandates that each run yields AT MOST ONE terminal event
(RUN_ERROR XOR RUN_FINISHED). The vendored ``ag_ui_adk`` library has a
known bug where the queue-based execution path can emit both — the
background task pushes a RUN_ERROR via the event queue (gets yielded to
us normally), then the outer try-block falls through to emit
RUN_FINISHED because the queue-delivered error doesn't propagate as a
Python exception. The ``@ag-ui/client`` state machine correctly
rejects the duplicate with::

    Cannot send event type 'RUN_FINISHED': The run has already errored
    with 'RUN_ERROR'.

``stream_agui_events`` enforces the spec invariant — keep the first
terminal event, drop any subsequent ones with a warning log — so every
fork using this template is protected without anyone needing to patch
the vendored library.

These tests pin the 4 cases that matter:
  1. Duplicate ERROR-then-FINISHED (the bug-as-observed) → only the
     ERROR reaches the wire.
  2. Duplicate FINISHED-then-ERROR (symmetric defence) → only the
     FINISHED reaches the wire.
  3. Lone ERROR → passes through unchanged.
  4. Lone FINISHED → passes through unchanged.
Plus a regression check that non-terminal events still flow.
"""

from __future__ import annotations

import logging
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from adk.agui import stream_agui_events


class _FakeEventType:
    """Mimics the ``ag_ui.core.EventType`` enum's ``.value`` attribute."""

    def __init__(self, value: str) -> None:
        self.value = value


class _FakeEvent:
    """Minimal stand-in for an ``ag_ui.core.BaseEvent``.

    Only needs the two surfaces ``stream_agui_events`` touches:
      * ``.type`` with a ``.value`` string (read for first-token and dedup logic)
      * ``.model_dump(by_alias=…, exclude_none=…)`` returning a dict
    """

    def __init__(self, type_value: str, **extra: Any) -> None:
        self.type = _FakeEventType(type_value)
        self._extra = extra

    def model_dump(self, *, by_alias: bool = True, exclude_none: bool = True) -> dict:
        return {"type": self.type.value, **self._extra}


class _FakeAguiAgent:
    """Minimal ``ADKAgent`` stand-in whose ``run()`` yields a scripted sequence."""

    def __init__(self, events: list[_FakeEvent]) -> None:
        self._events = events

    async def run(self, _run_input: Any):
        for event in self._events:
            yield event


def _make_run_input(thread_id: str = "thread-test"):
    """Lightweight ``RunAgentInput`` stand-in — only ``.thread_id`` is read."""
    ri = MagicMock()
    ri.thread_id = thread_id
    return ri


@pytest.fixture
def noop_tracker():
    """Patch ``observability.timing.get_current_tracker`` to a no-op so the
    function under test doesn't try to mark real stage events."""
    tracker = MagicMock()
    tracker.drain_stage_events.return_value = []
    with patch("observability.timing.get_current_tracker", return_value=tracker):
        yield tracker


async def _collect(stream) -> list[dict]:
    return [event async for event in stream]


# --- The bug-as-observed --------------------------------------------------


@pytest.mark.asyncio
async def test_drops_run_finished_after_run_error(noop_tracker, caplog):
    """The gde-ap-agent failure mode: a tool throws → ag_ui_adk emits
    RUN_ERROR via the queue → outer try-block then emits RUN_FINISHED.
    The wrap should keep the ERROR and drop the FINISHED.
    """
    agent = _FakeAguiAgent(
        [
            _FakeEvent("RUN_STARTED"),
            _FakeEvent("TOOL_CALL_START"),
            _FakeEvent("RUN_ERROR", message="vendor lookup failed"),
            _FakeEvent("RUN_FINISHED"),  # duplicate terminal — must be dropped
        ]
    )

    with caplog.at_level(logging.WARNING, logger="adk.agui"):
        events = await _collect(stream_agui_events(agent, _make_run_input()))

    types = [e["type"] for e in events]
    assert types == ["RUN_STARTED", "TOOL_CALL_START", "RUN_ERROR"]
    # Warning was logged so we can track upstream-bug frequency.
    assert any("agui_terminal_dedup" in rec.message and "first=RUN_ERROR" in rec.message for rec in caplog.records)


# --- Symmetric defence ----------------------------------------------------


@pytest.mark.asyncio
async def test_drops_run_error_after_run_finished(noop_tracker, caplog):
    """Defence in depth: if upstream ever ships an off-by-one where
    RUN_FINISHED arrives first and RUN_ERROR trails it, the dedup is
    symmetric — only the first terminal event reaches the wire.
    """
    agent = _FakeAguiAgent(
        [
            _FakeEvent("RUN_STARTED"),
            _FakeEvent("RUN_FINISHED"),
            _FakeEvent("RUN_ERROR", message="late error"),  # dropped
        ]
    )

    with caplog.at_level(logging.WARNING, logger="adk.agui"):
        events = await _collect(stream_agui_events(agent, _make_run_input()))

    types = [e["type"] for e in events]
    assert types == ["RUN_STARTED", "RUN_FINISHED"]
    assert any("agui_terminal_dedup" in rec.message and "first=RUN_FINISHED" in rec.message for rec in caplog.records)


# --- Pass-through happy paths --------------------------------------------


@pytest.mark.asyncio
async def test_lone_run_error_passes_through(noop_tracker, caplog):
    """The well-behaved error path (only RUN_ERROR, no trailing FINISHED)
    must NOT trigger the dedup warning."""
    agent = _FakeAguiAgent([_FakeEvent("RUN_STARTED"), _FakeEvent("RUN_ERROR", message="some failure")])

    with caplog.at_level(logging.WARNING, logger="adk.agui"):
        events = await _collect(stream_agui_events(agent, _make_run_input()))

    assert [e["type"] for e in events] == ["RUN_STARTED", "RUN_ERROR"]
    assert not any("agui_terminal_dedup" in rec.message for rec in caplog.records)


@pytest.mark.asyncio
async def test_lone_run_finished_passes_through(noop_tracker, caplog):
    """The normal completion path must not trigger any dedup logic."""
    agent = _FakeAguiAgent(
        [
            _FakeEvent("RUN_STARTED"),
            _FakeEvent("TEXT_MESSAGE_START"),
            _FakeEvent("TEXT_MESSAGE_CONTENT", delta="hi"),
            _FakeEvent("TEXT_MESSAGE_END"),
            _FakeEvent("RUN_FINISHED"),
        ]
    )

    with caplog.at_level(logging.WARNING, logger="adk.agui"):
        events = await _collect(stream_agui_events(agent, _make_run_input()))

    assert [e["type"] for e in events] == [
        "RUN_STARTED",
        "TEXT_MESSAGE_START",
        "TEXT_MESSAGE_CONTENT",
        "TEXT_MESSAGE_END",
        "RUN_FINISHED",
    ]
    assert not any("agui_terminal_dedup" in rec.message for rec in caplog.records)


# --- Regressions ----------------------------------------------------------


@pytest.mark.asyncio
async def test_non_terminal_events_after_first_terminal_still_drop(noop_tracker):
    """Subtle invariant: per AG-UI spec, NOTHING should follow a terminal
    event. If upstream ever does emit non-terminals after a terminal, we
    only need to enforce the dedup for ``RUN_ERROR``/``RUN_FINISHED``;
    other event types are not in our enforcement scope. This pins that
    contract so a future refactor doesn't accidentally widen the filter."""
    agent = _FakeAguiAgent(
        [
            _FakeEvent("RUN_STARTED"),
            _FakeEvent("RUN_FINISHED"),
            # Hypothetical post-terminal non-terminal — passes through.
            _FakeEvent("CUSTOM_TELEMETRY", payload="oops"),
        ]
    )

    events = await _collect(stream_agui_events(agent, _make_run_input()))
    assert [e["type"] for e in events] == [
        "RUN_STARTED",
        "RUN_FINISHED",
        "CUSTOM_TELEMETRY",
    ]


@pytest.mark.asyncio
async def test_warning_log_includes_thread_id_for_observability(noop_tracker, caplog):
    """The dedup warning must include the AG-UI thread_id so on-call
    can correlate dropped-terminal events with chat sessions in the
    backend logs (template-agui-terminal-dedup.md "Observability")."""
    agent = _FakeAguiAgent(
        [
            _FakeEvent("RUN_STARTED"),
            _FakeEvent("RUN_ERROR", message="x"),
            _FakeEvent("RUN_FINISHED"),  # dropped, expect thread_id in log
        ]
    )

    with caplog.at_level(logging.WARNING, logger="adk.agui"):
        await _collect(stream_agui_events(agent, _make_run_input(thread_id="thread-abc-123")))

    assert any("thread-abc-123" in rec.message for rec in caplog.records)
