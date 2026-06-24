"""extract_ppa_clauses — typed PPA-contract clause extraction (v6.4.0 ONE-DEMO M2).

ADK FunctionTool that takes a `doc_id` for an already-parsed PPA contract and
returns structured `PpaClauses` JSON with `block_id` citations on every
populated clause. Renders downstream as the A2UI `ClauseExtractionCard`.

Implementation pattern follows tools/structured_extraction.py:
  - Load AILANG blocks via build_document_context(doc_id, mode="blocks")
  - Run Gemini structured-output with response_schema=PpaClauses
  - Return JSON string (ADK FunctionTool contract requires str return)

Why this lives as a standalone FunctionTool rather than the existing
structured_extraction_callback path:
  - The callback fires AFTER agent response, useful when the agent
    organically reads a doc then we extract. This tool is INSTEAD: the
    skill calls it explicitly when the user asks "extract clauses".
  - Returning typed JSON to the agent lets it compose with
    compare_ppa_contracts (M3) without re-reading state.
  - Predictable A2UI artefact emission: tool result is the card payload.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os

from google import genai
from google.adk.tools import ToolContext

from tools.documents.ailang_parse import parse_gcs_file
from tools.documents.context import build_document_context
from tools.schemas.ppa_clauses import PpaClauses

log = logging.getLogger(__name__)

_EXTRACTION_MODEL = os.environ.get("EXTRACTION_MODEL", "gemini-2.5-flash")

_EXTRACTION_PROMPT = """You are a precise PPA (Power Purchase Agreement) contract analyst.

Extract the standard PPA clauses from the document blocks below into the
provided JSON schema. For every populated clause:

  1. Set `value` to the normalised extracted value (e.g. "PaP", "Fixed
     €45/MWh CPI-indexed", "20 years")
  2. Copy the verbatim contract text into `raw_excerpt`
  3. Set `block_id` to the AILANG block id of the source span. If a clause
     spans multiple blocks, pick the most representative one.
  4. Set `confidence`:
       high   — definition is explicit and the value is unambiguous
       medium — value is reasonable inference from context
       low    — clause referenced but value is unclear or partial
  5. Use `notes` to surface caveats (e.g. "definition references Annex A
     which is not included").

For any standard clause field NOT present in the document, leave it as
null. Do NOT invent or hallucinate clauses.

For non-standard contract-specific clauses (e.g. unusual hedge mechanics,
bespoke termination triggers), add them to `other_clauses[]` with a
descriptive `clause_name`.

Settlement type values: PaP | PaN | BL
Contract form values: Physical | Financial-FS | Financial-PS

Document blocks (JSON):
"""


async def extract_ppa_clauses(
    doc_id: str | None = None,
    gs_url: str | None = None,
    tool_context: ToolContext = None,
) -> str:
    """Extract PPA clauses from a contract document with block_id citations.

    Use this tool when the user asks to "extract clauses", "summarise the
    contract terms", "show me the PPA structure", or similar requests on
    a specific document.

    Two input modes — pass EXACTLY ONE:
      - `doc_id`: an already-uploaded document in parsed_documents/{doc_id}
        (the path used after `list_documents` / `read_org_document`)
      - `gs_url`: a direct `gs://bucket/path/file.docx` URL. The tool runs
        AILANG Parse on the fly and never touches Firestore — useful when
        the agent discovers a PPA via `list_documents_in_bucket` and wants
        to analyse it without an explicit upload step. Requires the
        runtime SA to hold roles/storage.objectViewer on the bucket.

    Returns JSON for a `PpaClauses` object covering the 12 standard PPA
    clauses (counterparties, volume, term, settlement type, contract form,
    price formula, RtM provider, force majeure, change of law, termination,
    governing law) plus an `other_clauses` array for contract-specific items.

    Every populated clause carries a `block_id` citation pointing to the
    AILANG block in the source document. Empty clauses (null `value`) mean
    the clause was not located in the document, NOT that the contract lacks
    it — re-read with a different prompt or ask the user to point at the
    section.

    Args:
        doc_id: Firestore parsed_documents/{doc_id} of the contract.
        gs_url: gs://bucket/path GCS URL to parse on the fly.

    Returns:
        JSON string of a `PpaClauses` object. On error, a JSON string of
        `{"error": "...", "doc_id": ...}` (agent surfaces gracefully).
    """
    # Resolve identity for response payloads + caching keys. doc_id wins
    # for display; gs_url is the alternate when no Firestore record exists.
    if doc_id and gs_url:
        return json.dumps(
            {
                "error": "Pass exactly one of doc_id or gs_url, not both.",
                "doc_id": doc_id,
            }
        )
    if not doc_id and not gs_url:
        return json.dumps(
            {
                "error": "Either doc_id or gs_url is required.",
                "doc_id": None,
            }
        )

    identity = doc_id or gs_url
    blocks = None

    if doc_id is not None:
        try:
            _content, blocks = await asyncio.to_thread(build_document_context, doc_id, "blocks", None)
        except KeyError:
            return json.dumps(
                {
                    "error": (
                        f"Document '{doc_id}' not found in parsed_documents. Use "
                        "list_documents to see uploaded documents, or list_documents_in_bucket "
                        "to discover unparsed files in the tenant bucket."
                    ),
                    "doc_id": doc_id,
                }
            )
        except Exception as exc:
            log.warning("extract_ppa_clauses: build_document_context failed for %s: %s", doc_id, exc)
            return json.dumps(
                {
                    "error": f"Could not load document '{doc_id}': {exc}",
                    "doc_id": doc_id,
                }
            )
    else:
        # gs_url branch — parse on the fly via AILANG Parse. No Firestore write.
        try:
            outcome = await parse_gcs_file(gs_url, "blocks")
        except Exception as exc:
            log.warning("extract_ppa_clauses: parse_gcs_file raised for %s: %s", gs_url, exc)
            return json.dumps(
                {
                    "error": f"AILANG Parse failed for {gs_url}: {exc}",
                    "doc_id": gs_url,
                }
            )
        if outcome is None:
            return json.dumps(
                {
                    "error": (
                        f"AILANG Parse did not support {gs_url} (extension not in the "
                        "deterministic set). Convert to .docx/.pdf and re-try."
                    ),
                    "doc_id": gs_url,
                }
            )
        if outcome.error:
            return json.dumps(
                {
                    "error": f"AILANG Parse error on {gs_url}: {outcome.error}",
                    "doc_id": gs_url,
                    "error_code": outcome.error_code,
                }
            )
        blocks = outcome.blocks

    if not blocks:
        return json.dumps(
            {
                "error": (
                    f"Document '{identity}' has no parsed blocks. It may still be processing or "
                    "failed to parse. Ask the user to retry."
                ),
                "doc_id": identity,
            }
        )

    try:
        result_json = await _run_clause_extraction(blocks, identity)
    except Exception as exc:
        log.warning("extract_ppa_clauses: extraction call failed for %s: %s", identity, exc)
        return json.dumps(
            {
                "error": f"Clause extraction failed: {exc}",
                "doc_id": identity,
            }
        )

    # Round-trip validate so we never return malformed JSON to the agent.
    # On schema-violating output, we surface the raw text in `error` so the
    # agent can apologise and retry rather than emit half-formed A2UI.
    try:
        validated = PpaClauses.model_validate_json(result_json)
    except Exception as exc:
        log.warning("extract_ppa_clauses: schema validation failed for %s: %s", identity, exc)
        return json.dumps(
            {
                "error": f"Extracted JSON did not match PpaClauses schema: {exc}",
                "doc_id": identity,
            }
        )

    # If the tool was called via an ADK agent (tool_context present), stash
    # the typed result for compare_ppa_contracts (M3) to consume without
    # re-extracting. Keyed by whatever identity the agent used to call us
    # (doc_id or gs_url) — compare_ppa_contracts reads the SAME key.
    if tool_context is not None:
        tool_context.state[f"app:emitted:ppa_clauses:{identity}"] = validated.model_dump_json()

    return validated.model_dump_json()


async def _run_clause_extraction(blocks: list[dict], doc_id: str) -> str:
    """Run Gemini structured-output extraction over AILANG blocks.

    Uses `response_mime_type=application/json` + `response_schema` to
    constrain Gemini's output to the PpaClauses shape. The doc_id is
    injected into the schema so the model populates it (saves a
    post-processing step).
    """
    # Inject doc_id into the prompt so the model can populate the field
    # (the schema marks it required).
    blocks_json = json.dumps({"docId": doc_id, "blocks": blocks}, ensure_ascii=False)
    prompt = _EXTRACTION_PROMPT + blocks_json

    schema_dict = PpaClauses.model_json_schema()

    client = genai.Client(vertexai=True)
    response = await client.aio.models.generate_content(
        model=_EXTRACTION_MODEL,
        contents=prompt,
        config={
            "response_mime_type": "application/json",
            "response_schema": schema_dict,
        },
    )
    return response.text or "{}"
