"use client";

// KeyDifferencesPanel — A2UI artefact rendering of a PpaComparison
// (v6.4.0 ONE-DEMO M3). Mounts at the top of the doc-compare workbench.
//
// Each row shows: severity badge (material/moderate/cosmetic) + clause
// label + the agent-generated commercial implication. Clicking a row
// fires `onDifferenceClick` with the diff descriptor — the SideBySideDocViewer
// uses this to scroll both panes to the cited block_ids, and the agent
// receives a surface-action so the next turn can elaborate on the diff.
//
// Pure presentation component — consumes `PpaComparison` as a prop. The
// composition with the tool-call event stream is in the chat router
// (existing v6.2.0 artefact render hook plumbing).

import { useState } from "react";

import type { ClauseDifference, PpaComparison } from "@/types/ppa-clauses";

interface KeyDifferencesPanelProps {
  comparison: PpaComparison;
  onDifferenceClick?: (diff: ClauseDifference) => void;
}

const SEVERITY_BADGE: Record<ClauseDifference["severity"], string> = {
  material: "bg-rose-100 text-rose-800 border-rose-200",
  moderate: "bg-amber-100 text-amber-800 border-amber-200",
  cosmetic: "bg-gray-100 text-gray-600 border-gray-200",
};

const SEVERITY_ORDER: Record<ClauseDifference["severity"], number> = {
  material: 0,
  moderate: 1,
  cosmetic: 2,
};

export function KeyDifferencesPanel({ comparison, onDifferenceClick }: KeyDifferencesPanelProps) {
  const sortedDiffs = [...comparison.differences].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
  const materialCount = comparison.differences.filter((d) => d.severity === "material").length;

  if (comparison.differences.length === 0) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
        <strong>No material differences found.</strong> The two contracts agree on every
        standard PPA clause that was extracted.
      </div>
    );
  }

  return (
    <div
      className="rounded-lg border border-gray-200 bg-white shadow-sm"
      data-testid="key-differences-panel"
    >
      <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
        <div className="text-sm font-semibold text-gray-700">Key Differences</div>
        <div className="mt-0.5 text-xs text-gray-500">
          {comparison.differences.length} clause divergence
          {comparison.differences.length === 1 ? "" : "s"}
          {materialCount > 0 && `, ${materialCount} material`}. Click a row to navigate the
          source span in both contracts.
        </div>
      </div>
      <ul className="divide-y divide-gray-200">
        {sortedDiffs.map((diff) => (
          <DiffRow
            key={`${diff.clause_name}-${diff.left_block_id}-${diff.right_block_id}`}
            diff={diff}
            onClick={onDifferenceClick}
          />
        ))}
      </ul>
    </div>
  );
}

function DiffRow({
  diff,
  onClick,
}: {
  diff: ClauseDifference;
  onClick?: (diff: ClauseDifference) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isClickable = onClick !== undefined;

  function handleClick() {
    setExpanded((prev) => !prev);
    onClick?.(diff);
  }

  return (
    <li>
      <button
        type="button"
        onClick={handleClick}
        disabled={!isClickable}
        className="block w-full px-4 py-3 text-left transition hover:bg-gray-50 disabled:cursor-default disabled:hover:bg-transparent"
      >
        <div className="flex items-start gap-3">
          <span
            className={`mt-0.5 inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${
              SEVERITY_BADGE[diff.severity]
            }`}
          >
            {diff.severity}
          </span>
          <div className="flex-1">
            <div className="text-sm font-medium text-gray-800">{diff.display_name}</div>
            <div className="mt-1 text-sm text-gray-600">{diff.commercial_implication}</div>
            {expanded && (
              <dl className="mt-2 grid gap-2 text-xs text-gray-600 sm:grid-cols-2">
                <div>
                  <dt className="text-gray-400">Left</dt>
                  <dd className="font-mono">{diff.left_value ?? "—"}</dd>
                  <dd className="mt-0.5 text-[10px] text-gray-400">block {diff.left_block_id || "—"}</dd>
                </div>
                <div>
                  <dt className="text-gray-400">Right</dt>
                  <dd className="font-mono">{diff.right_value ?? "—"}</dd>
                  <dd className="mt-0.5 text-[10px] text-gray-400">block {diff.right_block_id || "—"}</dd>
                </div>
              </dl>
            )}
          </div>
        </div>
      </button>
    </li>
  );
}
