"""Tests for tools/compare_ppa_contracts.py (v6.4.0 ONE-DEMO M3).

Covers:
  - Happy path: two PpaClauses → Gemini comparison → typed PpaComparison
  - Cached extraction reuse from app:emitted:ppa_clauses:* state
  - Failed extraction on left side → structured error
  - Failed extraction on right side → structured error
  - Gemini call failure → structured error (no exception)
  - Schema-violating output → structured error
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from tools.schemas.ppa_clauses import (
    ClauseExtraction,
    PpaClauses,
    PpaComparison,
)


def _make_ctx(state: dict | None = None):
    ctx = MagicMock()
    ctx.state = state if state is not None else {}
    return ctx


def _sample_clauses(doc_id: str, settlement: str = "PaP", price: str = "Fixed €45/MWh") -> PpaClauses:
    return PpaClauses(
        doc_id=doc_id,
        settlement_type=ClauseExtraction(
            clause_name="settlement_type",
            display_name="Settlement Type",
            value=settlement,
            raw_excerpt=f"settlement shall be {settlement}",
            block_id=f"blk-set-{doc_id}",
            confidence="high",
        ),
        price_formula=ClauseExtraction(
            clause_name="price_formula",
            display_name="Price Formula",
            value=price,
            raw_excerpt=price,
            block_id=f"blk-price-{doc_id}",
            confidence="high",
        ),
    )


def _sample_comparison_json(left_id: str = "doc-A", right_id: str = "doc-B") -> str:
    left = _sample_clauses(left_id, settlement="PaP", price="Fixed €45/MWh")
    right = _sample_clauses(right_id, settlement="PaN", price="CPI-indexed")
    comp = PpaComparison(
        left=left,
        right=right,
        differences=[
            {
                "clause_name": "settlement_type",
                "display_name": "Settlement Type",
                "severity": "material",
                "left_value": "PaP",
                "right_value": "PaN",
                "left_block_id": "blk-set-doc-A",
                "right_block_id": "blk-set-doc-B",
                "commercial_implication": (
                    "Under right contract the Seller takes forecasting-error risk, "
                    "shifting balancing cost away from the Buyer."
                ),
            },
            {
                "clause_name": "price_formula",
                "display_name": "Price Formula",
                "severity": "material",
                "left_value": "Fixed €45/MWh",
                "right_value": "CPI-indexed",
                "left_block_id": "blk-price-doc-A",
                "right_block_id": "blk-price-doc-B",
                "commercial_implication": ("Right contract exposes Buyer to inflation; left contract caps it."),
            },
        ],
    )
    return comp.model_dump_json()


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_returns_typed_comparison_with_diffs():
    from tools.compare_ppa_contracts import compare_ppa_contracts

    left = _sample_clauses("doc-A")
    right = _sample_clauses("doc-B", settlement="PaN", price="CPI-indexed")

    async def _fake_extract(doc_id=None, gs_url=None, tool_context=None):
        if doc_id == "doc-A":
            return left.model_dump_json()
        return right.model_dump_json()

    comparison_json = _sample_comparison_json()

    with (
        patch("tools.compare_ppa_contracts.extract_ppa_clauses", new=AsyncMock(side_effect=_fake_extract)),
        patch(
            "tools.compare_ppa_contracts._run_comparison",
            new=AsyncMock(return_value=comparison_json),
        ),
    ):
        result = await compare_ppa_contracts("doc-A", "doc-B")

    parsed = json.loads(result)
    validated = PpaComparison.model_validate(parsed)
    assert validated.left.doc_id == "doc-A"
    assert validated.right.doc_id == "doc-B"
    assert len(validated.differences) == 2
    settlement_diff = next(d for d in validated.differences if d.clause_name == "settlement_type")
    assert settlement_diff.severity == "material"
    assert settlement_diff.left_block_id == "blk-set-doc-A"
    assert settlement_diff.right_block_id == "blk-set-doc-B"
    assert "balancing" in settlement_diff.commercial_implication.lower()


@pytest.mark.asyncio
async def test_uses_cached_extractions_when_available():
    """When M2 already stashed app:emitted:ppa_clauses:* for both docs, skip re-extracting."""
    from tools.compare_ppa_contracts import compare_ppa_contracts

    left = _sample_clauses("doc-A")
    right = _sample_clauses("doc-B", settlement="PaN")
    ctx = _make_ctx(
        {
            "app:emitted:ppa_clauses:doc-A": left.model_dump_json(),
            "app:emitted:ppa_clauses:doc-B": right.model_dump_json(),
        }
    )

    mock_extract = AsyncMock()  # should NOT be called
    comparison_json = _sample_comparison_json()

    with (
        patch("tools.compare_ppa_contracts.extract_ppa_clauses", new=mock_extract),
        patch(
            "tools.compare_ppa_contracts._run_comparison",
            new=AsyncMock(return_value=comparison_json),
        ),
    ):
        await compare_ppa_contracts("doc-A", "doc-B", tool_context=ctx)

    assert mock_extract.call_count == 0, "extract_ppa_clauses should not be called when state has cached extractions"
    # Stashes the comparison for follow-up "explain this diff" turns
    assert "app:emitted:ppa_comparison:doc-A:doc-B" in ctx.state


# ---------------------------------------------------------------------------
# Error paths — all return structured JSON, NEVER raise
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_left_extraction_failure_returns_structured_error():
    from tools.compare_ppa_contracts import compare_ppa_contracts

    error_payload = json.dumps({"error": "Document 'doc-missing' not found.", "doc_id": "doc-missing"})

    with patch(
        "tools.compare_ppa_contracts.extract_ppa_clauses",
        new=AsyncMock(return_value=error_payload),
    ):
        result = await compare_ppa_contracts("doc-missing", "doc-B")

    parsed = json.loads(result)
    assert "error" in parsed
    assert parsed["failed_side"] == "left"
    assert parsed["failed_doc_id"] == "doc-missing"
    assert parsed["left_doc_id"] == "doc-missing"


@pytest.mark.asyncio
async def test_right_extraction_failure_returns_structured_error():
    """Left succeeds, right fails — error names the right side."""
    from tools.compare_ppa_contracts import compare_ppa_contracts

    left = _sample_clauses("doc-A")
    right_error = json.dumps({"error": "Schema mismatch", "doc_id": "doc-broken"})

    async def _fake_extract(doc_id=None, gs_url=None, tool_context=None):
        if doc_id == "doc-A":
            return left.model_dump_json()
        return right_error

    with patch(
        "tools.compare_ppa_contracts.extract_ppa_clauses",
        new=AsyncMock(side_effect=_fake_extract),
    ):
        result = await compare_ppa_contracts("doc-A", "doc-broken")

    parsed = json.loads(result)
    assert "error" in parsed
    assert parsed["failed_side"] == "right"
    assert parsed["failed_doc_id"] == "doc-broken"


@pytest.mark.asyncio
async def test_gemini_call_failure_returns_structured_error():
    from tools.compare_ppa_contracts import compare_ppa_contracts

    left = _sample_clauses("doc-A")
    right = _sample_clauses("doc-B")

    async def _fake_extract(doc_id=None, gs_url=None, tool_context=None):
        return (left if doc_id == "doc-A" else right).model_dump_json()

    with (
        patch("tools.compare_ppa_contracts.extract_ppa_clauses", new=AsyncMock(side_effect=_fake_extract)),
        patch(
            "tools.compare_ppa_contracts._run_comparison",
            new=AsyncMock(side_effect=RuntimeError("429 Too Many Requests")),
        ),
    ):
        result = await compare_ppa_contracts("doc-A", "doc-B")

    parsed = json.loads(result)
    assert "error" in parsed
    assert "429" in parsed["error"]


@pytest.mark.asyncio
async def test_gs_url_pair_path_compares_bucket_resident_contracts():
    """Self-discovery path: agent discovers two PPAs in the tenant bucket via
    list_bucket_documents, then passes their gs:// URLs directly to
    compare_ppa_contracts. No parsed_documents/ entries required."""
    from tools.compare_ppa_contracts import compare_ppa_contracts

    left_url = "gs://multivac-acme-energy-bucket/PPAs/longform/contract-A.pdf"
    right_url = "gs://multivac-acme-energy-bucket/PPAs/longform/contract-B.pdf"
    left = _sample_clauses(left_url)
    right = _sample_clauses(right_url, settlement="PaN", price="CPI-indexed")

    async def _fake_extract(doc_id=None, gs_url=None, tool_context=None):
        if gs_url == left_url:
            return left.model_dump_json()
        if gs_url == right_url:
            return right.model_dump_json()
        raise AssertionError(f"Unexpected call: doc_id={doc_id} gs_url={gs_url}")

    comparison_json = _sample_comparison_json(left_url, right_url)

    with (
        patch("tools.compare_ppa_contracts.extract_ppa_clauses", new=AsyncMock(side_effect=_fake_extract)),
        patch(
            "tools.compare_ppa_contracts._run_comparison",
            new=AsyncMock(return_value=comparison_json),
        ),
    ):
        result = await compare_ppa_contracts(left_gs_url=left_url, right_gs_url=right_url)

    parsed = json.loads(result)
    from tools.schemas.ppa_clauses import PpaComparison as _PpaComparison

    validated = _PpaComparison.model_validate(parsed)
    assert validated.left.doc_id == left_url
    assert validated.right.doc_id == right_url
    assert len(validated.differences) >= 1


@pytest.mark.asyncio
async def test_mixed_mode_doc_id_left_gs_url_right():
    """Mix modes: one side uploaded (doc_id), one side from bucket (gs_url)."""
    from tools.compare_ppa_contracts import compare_ppa_contracts

    left_id = "doc-uploaded"
    right_url = "gs://bucket/PPAs/contract-B.pdf"
    left = _sample_clauses(left_id)
    right = _sample_clauses(right_url, settlement="PaN")

    async def _fake_extract(doc_id=None, gs_url=None, tool_context=None):
        if doc_id == left_id:
            return left.model_dump_json()
        if gs_url == right_url:
            return right.model_dump_json()
        raise AssertionError(f"Unexpected call: doc_id={doc_id} gs_url={gs_url}")

    comparison_json = _sample_comparison_json(left_id, right_url)

    with (
        patch("tools.compare_ppa_contracts.extract_ppa_clauses", new=AsyncMock(side_effect=_fake_extract)),
        patch(
            "tools.compare_ppa_contracts._run_comparison",
            new=AsyncMock(return_value=comparison_json),
        ),
    ):
        result = await compare_ppa_contracts(left_doc_id=left_id, right_gs_url=right_url)

    parsed = json.loads(result)
    assert "error" not in parsed


@pytest.mark.asyncio
async def test_both_modes_for_one_side_returns_structured_error():
    """Passing both doc_id and gs_url for the same side is a contract violation."""
    from tools.compare_ppa_contracts import compare_ppa_contracts

    result = await compare_ppa_contracts(left_doc_id="doc-A", left_gs_url="gs://bucket/A.pdf", right_doc_id="doc-B")
    parsed = json.loads(result)
    assert "error" in parsed
    assert "exactly one" in parsed["error"].lower()


@pytest.mark.asyncio
async def test_no_identity_for_one_side_returns_structured_error():
    """Neither doc_id nor gs_url for one side → structured error."""
    from tools.compare_ppa_contracts import compare_ppa_contracts

    result = await compare_ppa_contracts(left_doc_id="doc-A")
    parsed = json.loads(result)
    assert "error" in parsed
    assert "required" in parsed["error"].lower()


@pytest.mark.asyncio
async def test_schema_violating_output_returns_structured_error():
    """Gemini occasionally drops required fields — surface as structured error.

    Same EARNED TRUST guardrail as extract_ppa_clauses: never emit a
    half-formed PpaComparison through to the KeyDifferencesPanel.
    """
    from tools.compare_ppa_contracts import compare_ppa_contracts

    left = _sample_clauses("doc-A")
    right = _sample_clauses("doc-B")
    bogus = json.dumps({"differences": []})  # missing `left` + `right` required fields

    async def _fake_extract(doc_id=None, gs_url=None, tool_context=None):
        return (left if doc_id == "doc-A" else right).model_dump_json()

    with (
        patch("tools.compare_ppa_contracts.extract_ppa_clauses", new=AsyncMock(side_effect=_fake_extract)),
        patch(
            "tools.compare_ppa_contracts._run_comparison",
            new=AsyncMock(return_value=bogus),
        ),
    ):
        result = await compare_ppa_contracts("doc-A", "doc-B")

    parsed = json.loads(result)
    assert "error" in parsed
    assert "schema" in parsed["error"].lower() or "validation" in parsed["error"].lower()
