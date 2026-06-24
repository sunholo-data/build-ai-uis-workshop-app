"use client";

// ClauseExtractionCard — A2UI rendering of a PpaClauses extraction result.
// v6.4.0 ONE-DEMO M2 — used by one-ppa-expert skill via extract_ppa_clauses
// tool. Every populated clause carries a block_id citation to its source
// span. Click the citation chip to navigate the underlying document
// viewer (downstream wiring).
//
// Pure presentation component — consumes a typed PpaClauses object as
// prop. Wiring from the tool-call event stream lives in the chat router.

import type { PpaClauses, ClauseExtraction } from "@/types/ppa-clauses";

interface ClauseExtractionCardProps {
  clauses: PpaClauses;
  onCitationClick?: (docId: string, blockId: string) => void;
}

// Field display order — chronological order of a typical PPA negotiation
// so the card reads like a checklist.
const FIELD_ORDER: (keyof Omit<PpaClauses, "doc_id" | "other_clauses">)[] = [
  "counterparty_buyer",
  "counterparty_seller",
  "volume_mwh",
  "term_years",
  "settlement_type",
  "contract_form",
  "price_formula",
  "rtm_provider",
  "force_majeure",
  "change_of_law",
  "termination",
  "governing_law",
];

const CONFIDENCE_BADGE: Record<ClauseExtraction["confidence"], string> = {
  high: "bg-emerald-100 text-emerald-800",
  medium: "bg-amber-100 text-amber-800",
  low: "bg-rose-100 text-rose-800",
};

function ClauseRow({
  clause,
  docId,
  onCitationClick,
}: {
  clause: ClauseExtraction;
  docId: string;
  onCitationClick?: (docId: string, blockId: string) => void;
}) {
  const citationClickable = clause.block_id && onCitationClick;
  return (
    <tr className="border-b last:border-b-0">
      <td className="px-3 py-2 align-top font-medium text-gray-700 whitespace-nowrap">
        {clause.display_name}
      </td>
      <td className="px-3 py-2 align-top">
        <div className="text-gray-900">{clause.value ?? <span className="text-gray-400 italic">not found</span>}</div>
        {clause.raw_excerpt && (
          <div className="mt-1 text-xs text-gray-500 italic">&ldquo;{clause.raw_excerpt}&rdquo;</div>
        )}
        {clause.notes && <div className="mt-1 text-xs text-amber-700">Note: {clause.notes}</div>}
      </td>
      <td className="px-3 py-2 align-top">
        <span
          className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
            CONFIDENCE_BADGE[clause.confidence]
          }`}
        >
          {clause.confidence}
        </span>
      </td>
      <td className="px-3 py-2 align-top whitespace-nowrap">
        {citationClickable ? (
          <button
            type="button"
            onClick={() => onCitationClick(docId, clause.block_id)}
            className="text-xs text-teal-600 underline hover:text-teal-700"
            aria-label={`Open source block ${clause.block_id}`}
          >
            block {clause.block_id}
          </button>
        ) : clause.block_id ? (
          <span className="text-xs text-gray-500">block {clause.block_id}</span>
        ) : (
          <span className="text-xs text-gray-300">—</span>
        )}
      </td>
    </tr>
  );
}

export function ClauseExtractionCard({ clauses, onCitationClick }: ClauseExtractionCardProps) {
  const populated = FIELD_ORDER.map((field) => ({ field, value: clauses[field] })).filter(
    (entry): entry is { field: typeof entry.field; value: ClauseExtraction } => entry.value !== null && entry.value !== undefined,
  );

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
        <div className="text-sm font-semibold text-gray-700">PPA Clause Extraction</div>
        <div className="mt-0.5 text-xs text-gray-500">
          Document: <span className="font-mono">{clauses.doc_id}</span> ·{" "}
          {populated.length} of {FIELD_ORDER.length} standard clauses populated
          {clauses.other_clauses.length > 0 && ` · ${clauses.other_clauses.length} additional`}
        </div>
      </div>
      <table className="w-full text-sm" data-testid="clauses-table">
        <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
          <tr>
            <th className="px-3 py-2 text-left">Clause</th>
            <th className="px-3 py-2 text-left">Value</th>
            <th className="px-3 py-2 text-left">Confidence</th>
            <th className="px-3 py-2 text-left">Source</th>
          </tr>
        </thead>
        <tbody>
          {populated.length === 0 ? (
            <tr>
              <td colSpan={4} className="px-3 py-6 text-center text-sm text-gray-500">
                No standard PPA clauses were extracted from this document.
              </td>
            </tr>
          ) : (
            populated.map((entry) => (
              <ClauseRow
                key={entry.field}
                clause={entry.value}
                docId={clauses.doc_id}
                onCitationClick={onCitationClick}
              />
            ))
          )}
          {clauses.other_clauses.map((extra, idx) => (
            <ClauseRow
              key={`other-${idx}`}
              clause={extra}
              docId={clauses.doc_id}
              onCitationClick={onCitationClick}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
