"""`aiplatform sessions` — inspect ADK session state for debugging.

Sprint 1.25 — small helper for "is the iframe actually pushing
ui/update-model-context properly?" without staring at backend logs.
Filters session state to the `mcp_app_context.*` namespace by default.

Sprint ACTION-TRIGGER M3.2 — `trigger-action` subcommand wires the
new `/api/skills/{skill_id}/sessions/{session_id}/surface-action-run`
endpoint into the CLI so the Pattern 1 action-triggered agent loop
can be driven (and smoke-tested) from a terminal without Chrome.

Endpoints used:
    GET  /api/sessions/{session_id}                                — session metadata
    GET  /api/sessions/{session_id}/state                          — full ADK state
                                                                     (filtered locally)
    POST /api/skills/{skill_id}/sessions/{session_id}/surface-action-run
                                                                   — write A2UI action
                                                                     + run agent
                                                                     (SSE stream)
"""

from __future__ import annotations

import datetime as _dt
import json as _json
import sys as _sys

import click
import httpx

from aiplatform.http import AIPlatformClient, APIError, resolve_base_url

_NAMESPACE_PREFIX = "mcp_app_context."


def _client(ctx: click.Context) -> AIPlatformClient:
    return AIPlatformClient(env=ctx.obj["env"])


@click.group()
def sessions() -> None:
    """Inspect chat sessions and their iframe-app context."""


@sessions.command("inspect")
@click.argument("session_id")
@click.option(
    "--mcp-context",
    "mcp_context_only",
    is_flag=True,
    help=("Only show the `mcp_app_context.*` namespace (sprint 1.25). Useful for debugging iframe→agent context flow."),
)
@click.pass_context
def inspect(ctx: click.Context, session_id: str, mcp_context_only: bool) -> None:
    """Show metadata + state for SESSION_ID.

    With --mcp-context, prints only the `mcp_app_context.*` namespace
    so you can verify MCP App iframes are pushing
    `ui/update-model-context` correctly.
    """
    client = _client(ctx)
    meta = client.get(f"/api/sessions/{session_id}")
    state = client.get(f"/api/sessions/{session_id}/state") or {}

    if mcp_context_only:
        filtered = {k: v for k, v in state.items() if k.startswith(_NAMESPACE_PREFIX)}
        if not filtered:
            click.echo(
                f"No keys with prefix {_NAMESPACE_PREFIX!r} in session "
                f"{session_id}. Has any MCP App iframe been rendered + "
                f"interacted with in this session?"
            )
            return
        click.echo(_json.dumps(filtered, indent=2, default=str))
        return

    click.echo("=== Session metadata ===")
    click.echo(_json.dumps(meta, indent=2, default=str))
    click.echo("\n=== Session state ===")
    click.echo(_json.dumps(state, indent=2, default=str))


@sessions.command("bootstrap")
@click.argument("session_id")
@click.option("--skill-id", required=True, help="Skill ID to record on the session index.")
@click.pass_context
def bootstrap(ctx: click.Context, session_id: str, skill_id: str) -> None:
    """Pre-create the ChatSessionIndex + ADK session for SESSION_ID.

    Normally called automatically by the frontend on mount. Use this command
    to manually bootstrap a session when debugging iframe context flow or
    testing the session API without going through the chat UI.

    Idempotent: safe to call multiple times for the same SESSION_ID.
    """
    client = _client(ctx)
    result = client.post(
        f"/api/sessions/{session_id}/bootstrap",
        json={"skill_id": skill_id},
    )
    if result is None:
        click.echo("Bootstrap succeeded (session already existed).")
        return
    created = result.get("created", False)
    if created:
        click.echo(f"Session {session_id} bootstrapped (new index created).")
    else:
        click.echo(f"Session {session_id} already existed — no-op.")


def _parse_json_option(raw: str | None, flag_name: str) -> object | None:
    """Parse a CLI JSON option, raising a Click usage error on bad JSON."""
    if raw is None:
        return None
    try:
        return _json.loads(raw)
    except ValueError as exc:
        raise click.UsageError(f"--{flag_name} must be valid JSON: {exc}") from exc


@sessions.command("trigger-action")
@click.argument("session_id")
@click.option(
    "--skill",
    "skill_id",
    required=True,
    help="Skill ID whose surface-action-run endpoint should be invoked.",
)
@click.option(
    "--surface",
    "surface_id",
    required=True,
    help="A2UI surface ID the action targets (must already be rendered in the session).",
)
@click.option(
    "--action",
    "action_name",
    required=True,
    help="Action name to dispatch (e.g. `increment`, `submit`).",
)
@click.option(
    "--component",
    "component_id",
    default=None,
    help="Optional `sourceComponentId` — the A2UI component that fired the action.",
)
@click.option(
    "--context",
    "context_json",
    default=None,
    help="Optional `action.context` payload as a JSON string (≤ 4 KB serialised).",
)
@click.option(
    "--state",
    "state_json",
    default=None,
    help=("Optional `forwardedProps.a2ui_surface_state` snapshot as a JSON string. Defaults to `{}` (empty snapshot)."),
)
@click.option(
    "--timeout",
    default=60.0,
    show_default=True,
    type=float,
    help="HTTP timeout for the streaming request, in seconds.",
)
@click.option(
    "--pretty",
    is_flag=True,
    default=False,
    help="Pretty-print each AG-UI event with indent=2 (default: compact one-line-per-event).",
)
@click.pass_context
def trigger_action(
    ctx: click.Context,
    session_id: str,
    skill_id: str,
    surface_id: str,
    action_name: str,
    component_id: str | None,
    context_json: str | None,
    state_json: str | None,
    timeout: float,
    pretty: bool,
) -> None:
    """Trigger an A2UI action on SESSION_ID, run the agent, stream AG-UI events.

    POSTs to ``/api/skills/{SKILL_ID}/sessions/{SESSION_ID}/surface-action-run``
    with the action + optional surface-state snapshot, then consumes the
    ``text/event-stream`` response. Each AG-UI event is printed to stdout —
    one compact JSON per line by default (grep-friendly for the M3.3 smoke
    script) or pretty-printed with --pretty.

    Exit codes:
      0  Stream terminated with `RUN_FINISHED`.
      1  Stream terminated with `RUN_ERROR`.
      2  HTTP error from the endpoint (e.g. 403 — skill not opted in via
         `allow_action_triggered_runs: true`). Response body is printed
         to stderr.

    Requires the skill to opt in via
    ``tool_configs.a2ui.allow_action_triggered_runs: true``; the backend
    returns 403 otherwise (see action-triggered-agent-turn design doc).
    """
    env = ctx.obj["env"]
    base_url = resolve_base_url(env)
    client = AIPlatformClient(env=env, base_url=base_url)
    headers = client._auth_headers()  # noqa: SLF001  internal helper, intentional
    headers["Accept"] = "text/event-stream"

    parsed_context = _parse_json_option(context_json, "context")
    parsed_state = _parse_json_option(state_json, "state")
    if parsed_state is None:
        parsed_state = {}

    body: dict[str, object] = {
        "surfaceId": surface_id,
        "action": {
            "name": action_name,
            "sourceComponentId": component_id,
            "timestamp": _dt.datetime.now(_dt.UTC).isoformat(),
            "context": parsed_context,
        },
        "forwardedProps": {"a2ui_surface_state": parsed_state},
    }

    url = f"{base_url}/api/skills/{skill_id}/sessions/{session_id}/surface-action-run"

    terminal_type: str | None = None

    try:
        with httpx.stream(
            "POST",
            url,
            headers=headers,
            json=body,
            timeout=timeout,
        ) as resp:
            if resp.status_code >= 400:
                detail = resp.read().decode("utf-8", errors="replace")
                click.echo(
                    f"HTTP {resp.status_code} from POST {url}\n{detail}",
                    err=True,
                )
                ctx.exit(2)
                return
            for line in resp.iter_lines():
                if not line.startswith("data:"):
                    continue
                payload = line[len("data:") :].strip()
                if not payload:
                    continue
                try:
                    event = _json.loads(payload)
                except ValueError:
                    # Malformed event — surface to stderr but keep streaming;
                    # backend should never emit this, so the smoke script
                    # will catch the regression via the stderr capture.
                    click.echo(f"Skipping malformed SSE payload: {payload}", err=True)
                    continue
                if pretty:
                    click.echo(_json.dumps(event, indent=2, sort_keys=True))
                else:
                    # Compact, one-line-per-event — newline-delimited so the
                    # smoke script in M3.3 can grep + line-count.
                    click.echo(_json.dumps(event, separators=(",", ":"), sort_keys=True))
                _sys.stdout.flush()

                event_type = event.get("type")
                if event_type in ("RUN_FINISHED", "RUN_ERROR"):
                    terminal_type = event_type
    except httpx.HTTPError as exc:
        raise APIError(f"HTTP transport error during trigger-action: {exc}") from exc

    if terminal_type == "RUN_ERROR":
        ctx.exit(1)
    elif terminal_type == "RUN_FINISHED":
        ctx.exit(0)
    else:
        # Stream ended without a terminal event — treat as a backend error
        # (per design doc, the dedup wrapper G41 guarantees exactly one
        # terminal event).
        click.echo(
            "Stream ended without a terminal RUN_FINISHED or RUN_ERROR event.",
            err=True,
        )
        ctx.exit(1)
