"""Tests for tools/extract_ppa_clauses.py (v6.4.0 ONE-DEMO M2).

Covers:
  - Happy path: valid blocks → Gemini extraction → typed PpaClauses JSON
  - Missing doc → structured error response, no exception
  - No blocks (still parsing) → structured error
  - Build failure → structured error
  - Schema-violating Gemini output → structured error with raw text
  - tool_context stash for downstream M3 compare tool
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from tools.schemas.ppa_clauses import PpaClauses


def _make_ctx(state: dict | None = None):
    ctx = MagicMock()
    ctx.state = state if state is not None else {}
    return ctx


def _sample_clauses_json(doc_id: str = "doc-1") -> str:
    """Return a valid PpaClauses JSON the mocked Gemini would produce."""
    return json.dumps(
        {
            "doc_id": doc_id,
            "counterparty_buyer": {
                "clause_name": "counterparty_buyer",
                "display_name": "Buyer",
                "value": "ACME Corp",
                "raw_excerpt": "ACME Corp (the Buyer)",
                "block_id": "blk-001",
                "confidence": "high",
            },
            "settlement_type": {
                "clause_name": "settlement_type",
                "display_name": "Settlement Type",
                "value": "PaP",
                "raw_excerpt": "settlement shall be Pay-as-Produced",
                "block_id": "blk-042",
                "confidence": "high",
            },
            "other_clauses": [],
        }
    )


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_returns_validated_ppa_clauses_json():
    from tools.extract_ppa_clauses import extract_ppa_clauses

    sample_blocks = [{"type": "paragraph", "text": "ACME Corp (the Buyer)", "block_id": "blk-001"}]
    sample_json = _sample_clauses_json("doc-1")

    with (
        patch(
            "tools.extract_ppa_clauses.build_document_context",
            return_value=("blocks-as-json-string", sample_blocks),
        ),
        patch(
            "tools.extract_ppa_clauses._run_clause_extraction",
            new=AsyncMock(return_value=sample_json),
        ),
    ):
        result = await extract_ppa_clauses("doc-1")

    parsed = json.loads(result)
    assert parsed["doc_id"] == "doc-1"
    # round-trips through the Pydantic model — proves schema-compliance
    validated = PpaClauses.model_validate(parsed)
    assert validated.counterparty_buyer is not None
    assert validated.counterparty_buyer.value == "ACME Corp"
    assert validated.counterparty_buyer.block_id == "blk-001"
    assert validated.settlement_type.value == "PaP"


@pytest.mark.asyncio
async def test_stashes_result_in_tool_context_for_m3_consumer():
    """compare_ppa_contracts (M3) reads app:emitted:ppa_clauses:{doc_id} to skip re-extracting."""
    from tools.extract_ppa_clauses import extract_ppa_clauses

    sample_blocks = [{"type": "paragraph", "text": "PPA", "block_id": "blk-x"}]
    sample_json = _sample_clauses_json("doc-2")
    ctx = _make_ctx()

    with (
        patch(
            "tools.extract_ppa_clauses.build_document_context",
            return_value=("blocks-json", sample_blocks),
        ),
        patch(
            "tools.extract_ppa_clauses._run_clause_extraction",
            new=AsyncMock(return_value=sample_json),
        ),
    ):
        await extract_ppa_clauses("doc-2", tool_context=ctx)

    assert "app:emitted:ppa_clauses:doc-2" in ctx.state
    stashed = json.loads(ctx.state["app:emitted:ppa_clauses:doc-2"])
    assert stashed["doc_id"] == "doc-2"


# ---------------------------------------------------------------------------
# Error paths — all return structured JSON, NEVER raise
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_missing_doc_returns_structured_error():
    from tools.extract_ppa_clauses import extract_ppa_clauses

    with patch(
        "tools.extract_ppa_clauses.build_document_context",
        side_effect=KeyError("doc-missing"),
    ):
        result = await extract_ppa_clauses("doc-missing")

    parsed = json.loads(result)
    assert "error" in parsed
    assert "doc-missing" in parsed["error"]
    assert parsed["doc_id"] == "doc-missing"


@pytest.mark.asyncio
async def test_unparsed_doc_returns_structured_error():
    """When build_document_context returns no blocks (still parsing / failed)."""
    from tools.extract_ppa_clauses import extract_ppa_clauses

    with patch(
        "tools.extract_ppa_clauses.build_document_context",
        return_value=("status message string", None),
    ):
        result = await extract_ppa_clauses("doc-pending")

    parsed = json.loads(result)
    assert "error" in parsed
    assert "no parsed blocks" in parsed["error"].lower() or "still" in parsed["error"].lower()
    assert parsed["doc_id"] == "doc-pending"


@pytest.mark.asyncio
async def test_gemini_call_failure_returns_structured_error():
    """Network error / quota / etc. on the Gemini call → structured error, no exception."""
    from tools.extract_ppa_clauses import extract_ppa_clauses

    sample_blocks = [{"type": "paragraph", "text": "PPA"}]
    with (
        patch(
            "tools.extract_ppa_clauses.build_document_context",
            return_value=("blocks-json", sample_blocks),
        ),
        patch(
            "tools.extract_ppa_clauses._run_clause_extraction",
            new=AsyncMock(side_effect=RuntimeError("503 Service Unavailable")),
        ),
    ):
        result = await extract_ppa_clauses("doc-quota")

    parsed = json.loads(result)
    assert "error" in parsed
    assert "503" in parsed["error"]
    assert parsed["doc_id"] == "doc-quota"


@pytest.mark.asyncio
async def test_neither_doc_id_nor_gs_url_returns_structured_error():
    from tools.extract_ppa_clauses import extract_ppa_clauses

    result = await extract_ppa_clauses()
    parsed = json.loads(result)
    assert "error" in parsed
    assert "required" in parsed["error"].lower()


@pytest.mark.asyncio
async def test_both_doc_id_and_gs_url_returns_structured_error():
    from tools.extract_ppa_clauses import extract_ppa_clauses

    result = await extract_ppa_clauses(doc_id="doc-A", gs_url="gs://bucket/file.docx")
    parsed = json.loads(result)
    assert "error" in parsed
    assert "exactly one" in parsed["error"].lower()


@pytest.mark.asyncio
async def test_gs_url_path_parses_on_the_fly_and_returns_clauses():
    """Self-discovery path: agent calls list_bucket_documents → picks a file →
    calls extract_ppa_clauses(gs_url=...) and gets typed clauses without any
    upload step. Mocks AILANG Parse to confirm the wiring."""
    from tools.extract_ppa_clauses import extract_ppa_clauses

    sample_blocks = [{"type": "paragraph", "text": "ACME Corp (the Buyer)", "block_id": "blk-001"}]
    sample_json = _sample_clauses_json("gs://bucket/X.pdf")

    fake_outcome = MagicMock()
    fake_outcome.blocks = sample_blocks
    fake_outcome.error = None

    with (
        patch(
            "tools.extract_ppa_clauses.parse_gcs_file",
            new=AsyncMock(return_value=fake_outcome),
        ),
        patch(
            "tools.extract_ppa_clauses._run_clause_extraction",
            new=AsyncMock(return_value=sample_json),
        ),
    ):
        result = await extract_ppa_clauses(gs_url="gs://bucket/X.pdf")

    parsed = json.loads(result)
    validated = PpaClauses.model_validate(parsed)
    assert validated.doc_id == "gs://bucket/X.pdf"


@pytest.mark.asyncio
async def test_gs_url_path_unsupported_extension_returns_structured_error():
    """parse_gcs_file returns None for unsupported extensions — we should
    not crash; surface a clear error pointing the user at the convert step."""
    from tools.extract_ppa_clauses import extract_ppa_clauses

    with patch(
        "tools.extract_ppa_clauses.parse_gcs_file",
        new=AsyncMock(return_value=None),
    ):
        result = await extract_ppa_clauses(gs_url="gs://bucket/scanned.tif")

    parsed = json.loads(result)
    assert "error" in parsed
    assert "extension" in parsed["error"].lower() or "deterministic" in parsed["error"].lower()


@pytest.mark.asyncio
async def test_gs_url_path_ailang_error_returns_structured_error():
    """When AILANG Parse rejects the file (auth, quota, api error), surface
    the outcome's error+code so the operator can debug."""
    from tools.extract_ppa_clauses import extract_ppa_clauses

    fake_outcome = MagicMock()
    fake_outcome.blocks = None
    fake_outcome.error = "Quota exceeded"
    fake_outcome.error_code = "quota"

    with patch(
        "tools.extract_ppa_clauses.parse_gcs_file",
        new=AsyncMock(return_value=fake_outcome),
    ):
        result = await extract_ppa_clauses(gs_url="gs://bucket/X.pdf")

    parsed = json.loads(result)
    assert "error" in parsed
    assert "Quota" in parsed["error"] or "quota" in parsed["error"]
    assert parsed.get("error_code") == "quota"


@pytest.mark.asyncio
async def test_schema_violating_output_returns_structured_error():
    """Gemini occasionally returns JSON that doesn't match the schema → structured error.

    This is the Axiom #2 guardrail: rather than emit half-formed A2UI cards
    with missing fields, surface the failure so the agent can apologise
    and retry. Better to feel reliable than magical.
    """
    from tools.extract_ppa_clauses import extract_ppa_clauses

    sample_blocks = [{"type": "paragraph", "text": "PPA"}]
    bogus_json = json.dumps({"not": "matching", "the_schema": True})  # missing doc_id

    with (
        patch(
            "tools.extract_ppa_clauses.build_document_context",
            return_value=("blocks-json", sample_blocks),
        ),
        patch(
            "tools.extract_ppa_clauses._run_clause_extraction",
            new=AsyncMock(return_value=bogus_json),
        ),
    ):
        result = await extract_ppa_clauses("doc-bogus")

    parsed = json.loads(result)
    assert "error" in parsed
    assert "schema" in parsed["error"].lower() or "validation" in parsed["error"].lower()
    assert parsed["doc_id"] == "doc-bogus"
