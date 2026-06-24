"""Tests for tools/entsoe_query.py (v6.4.0 ONE-DEMO M2 deferred unblock).

Covers:
  - Happy path: BQ returns rows → typed response with rows + source_uri
  - Empty range: BQ returns no rows → empty rows list, no exception
  - Missing args → structured error (no BQ call)
  - Inverted date range → structured error (no BQ call)
  - BQ failure → structured error with `hint` for schema mismatches

Integration test against the real BQ table is gated on
`ENTSOE_INTEGRATION_TEST=1` env var so it doesn't run in default CI.
"""

from __future__ import annotations

import os
from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import pytest


def _make_bq_row(ts: datetime, price: float):
    row = MagicMock()
    row.__getitem__.side_effect = lambda key: {"ts": ts, "price_eur_mwh": price}[key]
    return row


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_returns_rows_with_source_uri_citation():
    from tools.entsoe_query import entsoe_day_ahead_prices

    ts1 = datetime(2026, 6, 1, 0, 0, tzinfo=UTC)
    ts2 = datetime(2026, 6, 1, 1, 0, tzinfo=UTC)

    fake_client = MagicMock()
    fake_client.query.return_value.result.return_value = [
        _make_bq_row(ts1, 42.5),
        _make_bq_row(ts2, 45.0),
    ]

    with patch("google.cloud.bigquery.Client", return_value=fake_client):
        result = await entsoe_day_ahead_prices("DK1", "2026-06-01", "2026-06-02")

    assert "error" not in result
    assert result["row_count"] == 2
    assert result["bidding_zone"] == "DK1"
    assert result["start_date"] == "2026-06-01"
    assert result["rows"][0]["price_eur_mwh"] == 42.5
    assert result["rows"][0]["ts"].startswith("2026-06-01")
    # Source URI is the citation chip target — must include the BQ table
    # reference and the query parameters for traceability.
    assert "bq://your-entsoe-project.entsoe.day_ahead_prices" in result["source_uri"]
    assert "bidding_zone=DK1" in result["source_uri"]


@pytest.mark.asyncio
async def test_empty_range_returns_empty_rows_not_error():
    from tools.entsoe_query import entsoe_day_ahead_prices

    fake_client = MagicMock()
    fake_client.query.return_value.result.return_value = []

    with patch("google.cloud.bigquery.Client", return_value=fake_client):
        result = await entsoe_day_ahead_prices("DK1", "2026-06-01", "2026-06-02")

    assert "error" not in result
    assert result["row_count"] == 0
    assert result["rows"] == []
    assert "bq://" in result["source_uri"]


# ---------------------------------------------------------------------------
# Input validation — no BQ call burned on garbage
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_missing_args_returns_error_without_bq_call():
    from tools.entsoe_query import entsoe_day_ahead_prices

    with patch("google.cloud.bigquery.Client") as mock_bq:
        result = await entsoe_day_ahead_prices("", "2026-06-01", "2026-06-02")

    assert "error" in result
    assert "required" in result["error"].lower()
    assert mock_bq.call_count == 0


@pytest.mark.asyncio
async def test_inverted_date_range_returns_error_without_bq_call():
    from tools.entsoe_query import entsoe_day_ahead_prices

    with patch("google.cloud.bigquery.Client") as mock_bq:
        result = await entsoe_day_ahead_prices("DK1", "2026-06-07", "2026-06-01")

    assert "error" in result
    assert "before" in result["error"].lower()
    assert mock_bq.call_count == 0


# ---------------------------------------------------------------------------
# BQ failure — structured error with schema-hint
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_bq_failure_returns_structured_error_with_hint():
    from tools.entsoe_query import entsoe_day_ahead_prices

    fake_client = MagicMock()
    fake_client.query.side_effect = RuntimeError("Name 'bidding_zone' not found inside table")

    with patch("google.cloud.bigquery.Client", return_value=fake_client):
        result = await entsoe_day_ahead_prices("DK1", "2026-06-01", "2026-06-02")

    assert "error" in result
    assert "bidding_zone" in result["error"]
    assert "hint" in result
    assert "schema" in result["hint"].lower() or "column" in result["hint"].lower()
    # source_uri included even on failure, so the chat surface still has
    # something the user can click to debug in the BQ console.
    assert "bq://" in result["source_uri"]


# ---------------------------------------------------------------------------
# Integration — runs against live BQ if explicitly enabled
# ---------------------------------------------------------------------------


@pytest.mark.skipif(
    os.environ.get("ENTSOE_INTEGRATION_TEST") != "1",
    reason="Live BQ integration test — set ENTSOE_INTEGRATION_TEST=1 to enable",
)
@pytest.mark.asyncio
async def test_live_bq_query_returns_dk1_prices():
    """Smoke test against the real ENTSO-E table. Confirms IAM + schema."""
    from tools.entsoe_query import entsoe_day_ahead_prices

    result = await entsoe_day_ahead_prices("DK1", "2026-06-01", "2026-06-02")
    if "error" in result:
        pytest.fail(f"Live BQ call failed: {result['error']}\nHint: {result.get('hint', '')}")
    assert result["row_count"] >= 0
    if result["row_count"] > 0:
        first = result["rows"][0]
        assert first["ts"] is not None
        assert isinstance(first["price_eur_mwh"], float)
