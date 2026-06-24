"""Tests for tools/mcp/registry.py and adk/tools.py MCP wiring."""

from __future__ import annotations

from unittest.mock import patch

import pytest
from google.adk.tools.mcp_tool.mcp_session_manager import (
    SseConnectionParams,
    StreamableHTTPConnectionParams,
)
from google.adk.tools.mcp_tool.mcp_toolset import McpToolset


class TestGetMcpTools:
    def test_returns_toolset_for_http_server(self):
        from tools.mcp.registry import get_mcp_tools

        config = {"url": "http://localhost:9000/mcp", "transport": "http"}
        with patch("tools.mcp.registry.get_document", return_value=config):
            result = get_mcp_tools(["my-server"])

        assert len(result) == 1
        assert isinstance(result[0], McpToolset)

    def test_returns_sse_toolset_for_sse_transport(self):
        from tools.mcp.registry import _build_toolset

        config = {"url": "http://localhost:9000/sse", "transport": "sse"}
        toolset = _build_toolset("test-server", config)
        assert isinstance(toolset, McpToolset)
        assert isinstance(toolset._connection_params, SseConnectionParams)

    def test_returns_http_toolset_for_http_transport(self):
        from tools.mcp.registry import _build_toolset

        config = {"url": "http://localhost:9000/mcp", "transport": "http"}
        toolset = _build_toolset("test-server", config)
        assert isinstance(toolset, McpToolset)
        assert isinstance(toolset._connection_params, StreamableHTTPConnectionParams)

    def test_defaults_to_http_transport(self):
        from tools.mcp.registry import _build_toolset

        config = {"url": "http://localhost:9000/mcp"}
        toolset = _build_toolset("test-server", config)
        assert isinstance(toolset._connection_params, StreamableHTTPConnectionParams)

    def test_skips_server_not_found_in_firestore(self):
        from tools.mcp.registry import get_mcp_tools

        with patch("tools.mcp.registry.get_document", return_value=None):
            result = get_mcp_tools(["missing-server"])

        assert result == []

    def test_skips_server_missing_url(self):
        from tools.mcp.registry import _build_toolset

        result = _build_toolset("bad-server", {"transport": "http"})
        assert result is None

    def test_skips_server_on_firestore_error(self):
        from tools.mcp.registry import get_mcp_tools

        with patch("tools.mcp.registry.get_document", side_effect=RuntimeError("network")):
            result = get_mcp_tools(["broken-server"])

        assert result == []

    def test_returns_multiple_toolsets(self):
        from tools.mcp.registry import get_mcp_tools

        configs = {
            "server-a": {"url": "http://a.example.com/mcp"},
            "server-b": {"url": "http://b.example.com/mcp"},
        }
        with patch("tools.mcp.registry.get_document", side_effect=lambda _, sid: configs[sid]):
            result = get_mcp_tools(["server-a", "server-b"])

        assert len(result) == 2


class TestResolveMcpTools:
    def test_empty_when_no_mcp_config(self):
        from adk.tools import resolve_mcp_tools

        result = resolve_mcp_tools({})
        assert result == []

    def test_empty_when_mcp_has_no_servers(self):
        from adk.tools import resolve_mcp_tools

        result = resolve_mcp_tools({"mcp": {}})
        assert result == []

    def test_calls_get_mcp_tools_with_status_and_returns_resolved(self):
        """G42: the agent-build path uses ``get_mcp_tools_with_status`` so it
        can fail-loud when some servers don't resolve. Happy path: all
        declared servers resolve → resolve_mcp_tools returns the list."""
        from adk.tools import resolve_mcp_tools

        fake_a, fake_b = object(), object()
        with patch(
            "tools.mcp.registry.get_mcp_tools_with_status",
            return_value=([fake_a, fake_b], []),
        ) as mock:
            result = resolve_mcp_tools({"mcp": {"servers": ["srv-1", "srv-2"]}})

        mock.assert_called_once_with(["srv-1", "srv-2"])
        assert result == [fake_a, fake_b]

    def test_g42_raises_when_some_declared_servers_dont_resolve(self):
        """G42: the durable fix — if a SKILL.md declares MCP servers that
        aren't in Firestore (typo, missed seed, wrong env), the silently-
        partial behaviour masked many bugs (incl. Friction 7's SKILL.md
        tool drift). Now `resolve_mcp_tools` raises with a diff that
        names which server_ids failed so the operator can fix the seed.
        """
        from adk.tools import McpServerResolutionError, resolve_mcp_tools

        fake_resolved = object()
        with patch(
            "tools.mcp.registry.get_mcp_tools_with_status",
            return_value=([fake_resolved], ["missing-srv"]),
        ):
            with pytest.raises(McpServerResolutionError) as ei:
                resolve_mcp_tools({"mcp": {"servers": ["resolved-srv", "missing-srv"]}})

        # Error message must list the declared count, resolved count,
        # AND the specific missing IDs so the operator can fix the seed
        # without grepping logs.
        msg = str(ei.value)
        assert "2" in msg  # declared count
        assert "1" in msg  # resolved count
        assert "missing-srv" in msg
        assert "seed_mcp_servers" in msg  # pointer at the fix

    def test_g42_raises_when_all_declared_servers_fail_to_resolve(self):
        """All-miss path: zero resolved + N missing. The previous
        behaviour silently returned []; the agent built with no MCP
        tools and looked broken at run-time. Now: clear failure at
        build time."""
        from adk.tools import McpServerResolutionError, resolve_mcp_tools

        with patch(
            "tools.mcp.registry.get_mcp_tools_with_status",
            return_value=([], ["srv-a", "srv-b"]),
        ):
            with pytest.raises(McpServerResolutionError) as ei:
                resolve_mcp_tools({"mcp": {"servers": ["srv-a", "srv-b"]}})

        assert "srv-a" in str(ei.value)
        assert "srv-b" in str(ei.value)


class TestResolveToolsErrors:
    def test_raises_on_unknown_tool(self):
        from adk.tools import resolve_tools

        with pytest.raises(ValueError, match="Unknown tool"):
            resolve_tools(["nonexistent_tool"], {})

    def test_model_aware_tools_do_not_raise(self):
        from adk.tools import resolve_tools

        # ai_search and google_search are model-aware — no ValueError
        result = resolve_tools(["ai_search", "google_search"], {})
        assert result == []

    def test_mcp_tool_does_not_raise(self):
        from adk.tools import resolve_tools

        result = resolve_tools(["mcp"], {})
        assert result == []

    def test_code_execution_does_not_raise(self):
        from adk.tools import resolve_tools

        result = resolve_tools(["code_execution"], {})
        assert result == []


class TestGetMcpToolsWithStatus:
    """G42 (template-mcp-strict-resolution.md): the new resolver API that
    surfaces missing server_ids so the agent-build path can fail-loud."""

    def test_returns_resolved_and_empty_missing_when_all_succeed(self):
        from tools.mcp.registry import get_mcp_tools_with_status

        configs = {
            "server-a": {"url": "http://a.example.com/mcp"},
            "server-b": {"url": "http://b.example.com/mcp"},
        }
        with patch(
            "tools.mcp.registry.get_document",
            side_effect=lambda _coll, sid: configs[sid],
        ):
            resolved, missing = get_mcp_tools_with_status(["server-a", "server-b"])

        assert len(resolved) == 2
        assert missing == []

    def test_tracks_server_not_in_firestore_as_missing(self):
        from tools.mcp.registry import get_mcp_tools_with_status

        with patch("tools.mcp.registry.get_document", return_value=None):
            resolved, missing = get_mcp_tools_with_status(["nonexistent"])

        assert resolved == []
        assert missing == ["nonexistent"]

    def test_tracks_server_without_url_as_missing(self):
        """Doc exists in Firestore but is malformed (no url) — must
        register as missing so the strict resolver can name it in
        the failure diff."""
        from tools.mcp.registry import get_mcp_tools_with_status

        with patch(
            "tools.mcp.registry.get_document",
            return_value={"transport": "http"},  # no url
        ):
            resolved, missing = get_mcp_tools_with_status(["url-less"])

        assert resolved == []
        assert missing == ["url-less"]

    def test_tracks_firestore_error_as_missing(self):
        """Network / IAM / Firestore unavailable: the server can't be
        resolved, so it's missing. Caller decides whether to fail-loud."""
        from tools.mcp.registry import get_mcp_tools_with_status

        with patch(
            "tools.mcp.registry.get_document",
            side_effect=RuntimeError("firestore unavailable"),
        ):
            resolved, missing = get_mcp_tools_with_status(["unreachable"])

        assert resolved == []
        assert missing == ["unreachable"]

    def test_partial_resolution_reports_both_sides(self):
        """The most common G42-triggering case: a 2-server SKILL.md
        where one server is correctly seeded and one is missing. The
        resolver must return the one that worked AND the one that
        didn't — the strict caller picks how to react."""
        from tools.mcp.registry import get_mcp_tools_with_status

        def fake_get(_coll, sid):
            if sid == "ok":
                return {"url": "http://ok.example.com/mcp"}
            return None  # missing

        with patch("tools.mcp.registry.get_document", side_effect=fake_get):
            resolved, missing = get_mcp_tools_with_status(["ok", "broken"])

        assert len(resolved) == 1
        assert missing == ["broken"]

    def test_legacy_get_mcp_tools_still_skips_silently(self):
        """Backwards-compat invariant: ``get_mcp_tools`` (the pre-G42
        API) keeps the silently-skip behaviour for admin scripts and
        test fixtures that rely on it. The fail-loud is at the
        ``resolve_mcp_tools`` agent-build layer, not here."""
        from tools.mcp.registry import get_mcp_tools

        with patch("tools.mcp.registry.get_document", return_value=None):
            result = get_mcp_tools(["missing-server"])

        assert result == []  # no exception raised


class TestDeriveInProcessMcpBaseUrl:
    """G42 part (a) (template-mcp-strict-resolution.md): the loopback URL
    a fork should seed when registering in-process MCP servers. The
    public Cloud Run hostname routes to the FRONTEND container; only
    127.0.0.1:PORT reaches THIS process's FastMCP mount. Surfaced by
    gde-ap-agent fork ("Tool 'lookup_vendor' not found" on deployed)."""

    def test_default_is_loopback_port_1956(self, monkeypatch):
        from tools.mcp.registry import derive_in_process_mcp_base_url

        monkeypatch.delenv("MCP_INTERNAL_BASE_URL", raising=False)
        monkeypatch.delenv("PORT", raising=False)

        assert derive_in_process_mcp_base_url() == "http://127.0.0.1:1956"

    def test_respects_cloud_run_PORT_env_var(self, monkeypatch):
        """Cloud Run injects ``PORT`` into the container; the helper
        must pick that up so the loopback URL targets the right bind."""
        from tools.mcp.registry import derive_in_process_mcp_base_url

        monkeypatch.delenv("MCP_INTERNAL_BASE_URL", raising=False)
        monkeypatch.setenv("PORT", "8080")

        assert derive_in_process_mcp_base_url() == "http://127.0.0.1:8080"

    def test_MCP_INTERNAL_BASE_URL_override_wins(self, monkeypatch):
        """Ops-controlled override for test fixtures / alternate binds
        / non-loopback in-process MCP scenarios."""
        from tools.mcp.registry import derive_in_process_mcp_base_url

        monkeypatch.setenv("MCP_INTERNAL_BASE_URL", "http://10.0.0.5:9000")
        monkeypatch.setenv("PORT", "1956")  # ignored — override wins

        assert derive_in_process_mcp_base_url() == "http://10.0.0.5:9000"

    def test_strips_trailing_slash_on_override(self, monkeypatch):
        """Defensive: a trailing slash in the override would produce
        ``//mcp/...`` URLs when callers concatenate. Normalize at the
        helper boundary so every caller doesn't have to remember to."""
        from tools.mcp.registry import derive_in_process_mcp_base_url

        monkeypatch.setenv("MCP_INTERNAL_BASE_URL", "http://10.0.0.5:9000/")

        assert derive_in_process_mcp_base_url() == "http://10.0.0.5:9000"

    def test_empty_override_falls_through_to_port_logic(self, monkeypatch):
        """``MCP_INTERNAL_BASE_URL=`` (set-but-empty) is treated as 'no
        override', not 'use empty string'. Cloud Run pre-declares every
        configured env var as either the set value or empty string —
        so the empty case must NOT short-circuit. The check for
        ``PUBLIC_BASE_URL`` would have been wrong here too."""
        from tools.mcp.registry import derive_in_process_mcp_base_url

        monkeypatch.setenv("MCP_INTERNAL_BASE_URL", "")
        monkeypatch.setenv("PORT", "1956")

        assert derive_in_process_mcp_base_url() == "http://127.0.0.1:1956"
