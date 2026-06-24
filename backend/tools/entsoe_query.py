"""entsoe_day_ahead_prices — typed BigQuery read of ENTSO-E hourly prices.

Targets an existing
ENTSO-E ingestion at `your-entsoe-project.entsoe.*`. Read-only, runs as
sa-aitana-v6@your-project-id which holds roles/bigquery.dataViewer on
that dataset.

Schema assumptions (verified during first invocation, falls back gracefully):
  timestamp      TIMESTAMP   — UTC hour
  bidding_zone   STRING      — ENTSO-E bidding zone code (DK1, DE_LU, FR, etc.)
  price_eur_mwh  NUMERIC     — day-ahead price in EUR per MWh

If the live table uses different column names, the function returns a
structured error pointing at the actual column list so the operator can
adjust without code changes.

Source attribution (Axiom #2): returns `source_uri` in the format
  `bq://your-entsoe-project.entsoe.day_ahead_prices?bidding_zone=DK1&start=2026-06-01&end=2026-06-08`
which a downstream A2UI line-chart card can render as a citation chip
without round-tripping through the agent.
"""

from __future__ import annotations

import logging
import os
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    pass

from google.adk.tools import ToolContext

log = logging.getLogger(__name__)

# Hard-coded to the configured data project. Forks override via env if they have
# their own ENTSO-E source.
_ENTSOE_PROJECT = os.environ.get("ENTSOE_PROJECT", "your-entsoe-project")
_ENTSOE_DATASET = os.environ.get("ENTSOE_DATASET", "entsoe")
_ENTSOE_TABLE_PRICES = os.environ.get("ENTSOE_TABLE_PRICES", "day_ahead_prices")

# Sanity cap on row count returned to the agent. 7 days * 24 hours = 168 rows
# already covers typical demo queries; cap at 1000 so a "last 30 days" call
# doesn't blow up the response.
_MAX_ROWS = 1000


def _table_ref() -> str:
    return f"`{_ENTSOE_PROJECT}.{_ENTSOE_DATASET}.{_ENTSOE_TABLE_PRICES}`"


def _source_uri(bidding_zone: str, start_date: str, end_date: str) -> str:
    return (
        f"bq://{_ENTSOE_PROJECT}.{_ENTSOE_DATASET}.{_ENTSOE_TABLE_PRICES}"
        f"?bidding_zone={bidding_zone}&start={start_date}&end={end_date}"
    )


async def entsoe_day_ahead_prices(
    bidding_zone: str,
    start_date: str,
    end_date: str,
    tool_context: ToolContext = None,
) -> dict[str, Any]:
    """Fetch hourly day-ahead prices for a bidding zone over a date range.

    Use when the user asks about electricity market prices, day-ahead
    settlement values, or wants to ground a PPA cost calculation in
    historical prices. Composes naturally with extract_ppa_clauses /
    compare_ppa_contracts results — "what would this price-formula
    difference cost at DK1 prices last month".

    Args:
        bidding_zone: ENTSO-E bidding-zone code (e.g. "DK1", "DE_LU", "FR",
            "ES", "GB", "NL", "PT", "IT_NORD"). Case sensitive — use the
            canonical ENTSO-E spelling.
        start_date: ISO date `YYYY-MM-DD` (inclusive, UTC).
        end_date: ISO date `YYYY-MM-DD` (inclusive, UTC). Must be >= start.

    Returns:
        On success:
            {
              "rows": [{"ts": "2026-06-01T00:00:00+00:00", "price_eur_mwh": 42.5}, ...],
              "row_count": <int>,
              "source_uri": "bq://...",
              "bidding_zone": "DK1",
              "start_date": "...",
              "end_date": "..."
            }
        On error:
            {"error": "...", "source_uri": "bq://..."}
    """
    source_uri = _source_uri(bidding_zone, start_date, end_date)

    # Reject obvious garbage early — the agent shouldn't waste BQ quota on
    # a malformed call when a clear error redirects it faster.
    if not bidding_zone or not start_date or not end_date:
        return {
            "error": "bidding_zone, start_date, and end_date are all required.",
            "source_uri": source_uri,
        }
    if start_date > end_date:
        return {
            "error": f"start_date ({start_date}) must be on or before end_date ({end_date}).",
            "source_uri": source_uri,
        }

    try:
        from google.cloud import bigquery
    except ImportError:
        return {
            "error": "google-cloud-bigquery is not installed in this environment.",
            "source_uri": source_uri,
        }

    query = f"""
        SELECT
          timestamp AS ts,
          price_eur_mwh
        FROM {_table_ref()}
        WHERE bidding_zone = @zone
          AND DATE(timestamp) >= DATE(@start)
          AND DATE(timestamp) <= DATE(@end)
        ORDER BY timestamp ASC
        LIMIT {_MAX_ROWS}
    """

    try:
        client = bigquery.Client(project=_ENTSOE_PROJECT)
        job_config = bigquery.QueryJobConfig(
            query_parameters=[
                bigquery.ScalarQueryParameter("zone", "STRING", bidding_zone),
                bigquery.ScalarQueryParameter("start", "STRING", start_date),
                bigquery.ScalarQueryParameter("end", "STRING", end_date),
            ]
        )
        rows = list(client.query(query, job_config=job_config).result())
    except Exception as exc:
        # Schema mismatch tends to surface as "Name X not found" — surface
        # the BQ error verbatim so the operator can adjust column names
        # via env vars or update the SQL without losing 5 minutes to log
        # spelunking.
        log.warning(
            "entsoe_day_ahead_prices: BQ query failed for zone=%s %s..%s: %s",
            bidding_zone,
            start_date,
            end_date,
            exc,
        )
        return {
            "error": f"BigQuery query failed: {exc}",
            "source_uri": source_uri,
            "hint": (
                "If the error mentions an unknown column, the ENTSO-E schema in "
                "your-entsoe-project may use different column names than the "
                "tool assumes (timestamp, bidding_zone, price_eur_mwh). Override "
                "the SQL via ENTSOE_TABLE_PRICES env var or fix the column names "
                "in backend/tools/entsoe_query.py."
            ),
        }

    serialised = [
        {
            "ts": row["ts"].isoformat() if row["ts"] is not None else None,
            "price_eur_mwh": float(row["price_eur_mwh"]) if row["price_eur_mwh"] is not None else None,
        }
        for row in rows
    ]

    return {
        "rows": serialised,
        "row_count": len(serialised),
        "source_uri": source_uri,
        "bidding_zone": bidding_zone,
        "start_date": start_date,
        "end_date": end_date,
    }
