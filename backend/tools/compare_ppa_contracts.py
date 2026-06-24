"""compare_ppa_contracts — pairwise PPA diff with commercial-implication reasoning.

v6.4.0 ONE-DEMO M3. Composes M2's extract_ppa_clauses across two documents
and returns a typed PpaComparison with one ClauseDifference per material
divergence. Each diff carries both `left_block_id` + `right_block_id`
citations, severity (material / moderate / cosmetic), and a one-sentence
`commercial_implication`.

Reads from tool_context.state["app:emitted:ppa_clauses:{doc_id}"] when
present (M2 stashes typed extractions there) to skip re-running extraction
on docs the agent already analysed this turn. Otherwise runs extraction
inline. This is the function-as-schema composition pattern from G24.

Rendered downstream as the KeyDifferencesPanel A2UI artefact on the
workspace surface (M3 frontend), with click-to-explain via surface-action.
"""

from __future__ import annotations

import json
import logging
import os

from google import genai
from google.adk.tools import ToolContext

from tools.extract_ppa_clauses import extract_ppa_clauses
from tools.schemas.ppa_clauses import PpaClauses, PpaComparison

log = logging.getLogger(__name__)

# Comparison uses a stronger model than extraction — the diff reasoning
# requires multi-step commercial analysis. Default to Gemini 2.5 Pro;
# forks can override (e.g. claude-sonnet for cost/quality preference).
_COMPARISON_MODEL = os.environ.get("PPA_COMPARISON_MODEL", "gemini-2.5-pro")


_COMPARISON_PROMPT = """You are a precise PPA (Power Purchase Agreement) contract analyst.

Below are two extracted PpaClauses objects — `left` and `right` — covering
the same 12 standard PPA clause fields. Produce a typed `PpaComparison`
with `differences[]` listing every clause where the contracts diverge in a
way that would affect the deal.

For each ClauseDifference:
  1. Set `clause_name` and `display_name` to match the source field
  2. Carry the left + right values AND both source `block_id` citations so
     the user can navigate to either contract's span
  3. Set `severity` based on commercial impact:
       material — changes economics, risk allocation, or settlement
                  mechanics. Examples: PaP vs PaN, different price formula,
                  different term length, different settlement form
                  (financially-settled vs physically-settled).
       moderate — changes process or who-does-what but not the deal
                  economics. Examples: different RtM provider for the
                  same product, different governing law jurisdiction,
                  different termination notice period.
       cosmetic — wording or definitional rephrasing without functional
                  effect. Examples: different counterparty name spelling,
                  Annex reference numbering.
  4. Write `commercial_implication` as ONE concise sentence explaining
     why this divergence matters in practical terms. No hedging, no
     bullet lists, no apologies. Be factual.

Identical clauses (same value on both sides) should NOT appear in
`differences[]`. Skip clauses where BOTH sides are null (clause not
present in either contract) — that's not a divergence.

Carry both `left` and `right` PpaClauses verbatim from the input.

Two extracted PpaClauses (JSON):
"""


async def compare_ppa_contracts(
    left_doc_id: str | None = None,
    right_doc_id: str | None = None,
    left_gs_url: str | None = None,
    right_gs_url: str | None = None,
    tool_context: ToolContext = None,
) -> str:
    """Compare two PPA contracts clause-by-clause with commercial reasoning.

    Use this tool when the user asks to "compare these two PPAs", "what's
    different between contracts A and B", "show me a side-by-side", or
    similar comparison requests across two named documents.

    Two input modes per side — pass EXACTLY ONE of (doc_id, gs_url) per side:
      - `left_doc_id` / `right_doc_id`: parsed_documents/{doc_id} entries
      - `left_gs_url` / `right_gs_url`: direct `gs://bucket/path/file.docx`
        URLs. The tool runs AILANG Parse on the fly — useful when the agent
        discovered the contracts via `list_documents_in_bucket` and wants
        to compare without an explicit upload step.

    Left and right can mix modes (e.g. left from parsed_documents, right
    from a GCS URL) — each side is resolved independently.

    Output is a typed `PpaComparison` JSON containing:
      - `left` and `right`: full PpaClauses extractions for each contract
        (with block_id citations on every clause)
      - `differences`: ordered list of ClauseDifference rows covering
        every material / moderate / cosmetic divergence. Each diff
        includes both `left_block_id` and `right_block_id` for navigation,
        plus a one-sentence `commercial_implication`.

    Rendered downstream as the KeyDifferencesPanel workspace artefact —
    clicking any diff row in the UI triggers a `surface-action` that
    sends the diff descriptor back to the agent for follow-up explanation.

    Args:
        left_doc_id: First contract (parsed_documents path).
        right_doc_id: Second contract (parsed_documents path).
        left_gs_url: First contract (GCS URL, AILANG-parsed on the fly).
        right_gs_url: Second contract (GCS URL).

    Returns:
        JSON of a PpaComparison object. On error, JSON of
        `{"error": "...", "left_doc_id": ..., "right_doc_id": ...}`.
    """
    # Resolve identities up-front so the error/cache paths can reference them.
    left_id, left_err = _select_identity(left_doc_id, left_gs_url, "left")
    right_id, right_err = _select_identity(right_doc_id, right_gs_url, "right")
    if left_err:
        return json.dumps(
            {"error": left_err, "left_doc_id": left_doc_id or left_gs_url, "right_doc_id": right_doc_id or right_gs_url}
        )
    if right_err:
        return json.dumps(
            {
                "error": right_err,
                "left_doc_id": left_doc_id or left_gs_url,
                "right_doc_id": right_doc_id or right_gs_url,
            }
        )

    try:
        left_clauses = await _resolve_clauses(
            doc_id=left_doc_id, gs_url=left_gs_url, identity=left_id, tool_context=tool_context
        )
    except _ExtractionError as exc:
        return _error(exc, left_id, right_id, side="left")

    try:
        right_clauses = await _resolve_clauses(
            doc_id=right_doc_id, gs_url=right_gs_url, identity=right_id, tool_context=tool_context
        )
    except _ExtractionError as exc:
        return _error(exc, left_id, right_id, side="right")

    try:
        comparison_json = await _run_comparison(left_clauses, right_clauses)
    except Exception as exc:
        log.warning(
            "compare_ppa_contracts: comparison call failed for (%s, %s): %s",
            left_id,
            right_id,
            exc,
        )
        return json.dumps(
            {
                "error": f"Comparison failed: {exc}",
                "left_doc_id": left_id,
                "right_doc_id": right_id,
            }
        )

    try:
        validated = PpaComparison.model_validate_json(comparison_json)
    except Exception as exc:
        log.warning(
            "compare_ppa_contracts: schema validation failed for (%s, %s): %s",
            left_id,
            right_id,
            exc,
        )
        return json.dumps(
            {
                "error": f"Comparison JSON did not match PpaComparison schema: {exc}",
                "left_doc_id": left_id,
                "right_doc_id": right_id,
            }
        )

    if tool_context is not None:
        # Stash the comparison so a follow-up "explain this diff" turn can
        # read the typed structure without re-comparing.
        tool_context.state[f"app:emitted:ppa_comparison:{left_id}:{right_id}"] = validated.model_dump_json()

    return validated.model_dump_json()


def _select_identity(doc_id: str | None, gs_url: str | None, side: str) -> tuple[str | None, str | None]:
    """Validate and return (identity_string, error_or_None) for one side."""
    if doc_id and gs_url:
        return None, f"Pass exactly one of {side}_doc_id or {side}_gs_url, not both."
    if not doc_id and not gs_url:
        return None, f"Either {side}_doc_id or {side}_gs_url is required."
    return (doc_id or gs_url), None


class _ExtractionError(RuntimeError):
    """Raised internally when extract_ppa_clauses returns a structured error
    rather than a typed PpaClauses. Carries the error dict so we surface it."""

    def __init__(self, payload: dict):
        self.payload = payload
        super().__init__(payload.get("error", "Extraction failed"))


async def _resolve_clauses(
    *,
    doc_id: str | None,
    gs_url: str | None,
    identity: str,
    tool_context: ToolContext | None,
) -> PpaClauses:
    """Use cached extraction from state if present, else extract fresh.

    Cache key matches extract_ppa_clauses's stash key — whichever identity
    the agent passed (doc_id or gs_url) is what we key on. Reuse rather
    than burn a second Gemini call on the same identity in one turn.
    """
    if tool_context is not None:
        cached_key = f"app:emitted:ppa_clauses:{identity}"
        cached = tool_context.state.get(cached_key)
        if cached:
            try:
                return PpaClauses.model_validate_json(cached)
            except Exception:
                # Cache is stale/corrupt — fall through to re-extract
                log.info(
                    "compare_ppa_contracts: cached extraction for %s is unparseable; re-extracting",
                    identity,
                )

    raw = await extract_ppa_clauses(doc_id=doc_id, gs_url=gs_url, tool_context=tool_context)
    parsed = json.loads(raw)
    if "error" in parsed:
        raise _ExtractionError(parsed)
    return PpaClauses.model_validate(parsed)


def _error(exc: _ExtractionError, left_id: str | None, right_id: str | None, side: str) -> str:
    """Format an extraction error as the compare tool's structured error."""
    return json.dumps(
        {
            "error": f"Could not extract clauses for {side} document: {exc.payload.get('error')}",
            "left_doc_id": left_id,
            "right_doc_id": right_id,
            "failed_side": side,
            "failed_doc_id": exc.payload.get("doc_id"),
        }
    )


async def _run_comparison(left: PpaClauses, right: PpaClauses) -> str:
    """Run Gemini structured-output comparison over two PpaClauses extractions."""
    payload = {"left": left.model_dump(), "right": right.model_dump()}
    prompt = _COMPARISON_PROMPT + json.dumps(payload, ensure_ascii=False, indent=2)

    schema_dict = PpaComparison.model_json_schema()

    client = genai.Client(vertexai=True)
    response = await client.aio.models.generate_content(
        model=_COMPARISON_MODEL,
        contents=prompt,
        config={
            "response_mime_type": "application/json",
            "response_schema": schema_dict,
        },
    )
    return response.text or "{}"
