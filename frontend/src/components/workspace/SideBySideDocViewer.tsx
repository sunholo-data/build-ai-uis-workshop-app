"use client";

// SideBySideDocViewer — workbench centerpiece for one-doc-compare
// (v6.4.0 ONE-DEMO M3).
//
// Composes:
//   - WorkspaceDivider (drag-resize between the two panes)
//   - useSyncedScroll (proportional scroll lock)
//   - blockAlign algorithm (block_id + text-similarity fallback)
//   - BlocksRenderer (existing per-pane parsed-block rendering)
//
// Render contract:
//   - Two scrollable columns, drag-resizable divider in between
//   - Each row gets a diff classification (unchanged | modified | added | removed)
//   - Modified blocks get an amber left-border accent; added gets emerald,
//     removed gets rose. Unchanged stays neutral.
//   - When the consumer hooks up `selectedDiff`, the matching row on each
//     side gets a focused outline.
//
// Click handler: the consumer passes `onBlockClick` to be notified when
// a row is clicked; the SideBySideDocViewer's own scroll sync survives
// these clicks. KeyDifferencesPanel rows can wire `selectedDiff` to
// drive scroll-to-position via the imperative ref API.

import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from "react";

import { BlocksRenderer, type Block } from "@/components/document/BlocksRenderer";
import { useSyncedScroll } from "@/hooks/useSyncedScroll";
import { alignBlocks, type AlignableBlock, type AlignedRow, type DiffKind } from "@/lib/diff/blockAlign";

import { WorkspaceDivider } from "./WorkspaceDivider";

interface ParsedDoc {
  /** Stable doc id — passed back via onBlockClick so callers can route
   *  surface-action events to the right document. */
  docId: string;
  filename?: string;
  blocks: AlignableBlock[];
}

export interface SelectedDiff {
  /** Optional clause name from the active KeyDifferencesPanel row. */
  clauseName?: string;
  leftBlockId?: string;
  rightBlockId?: string;
}

interface SideBySideDocViewerProps {
  left: ParsedDoc;
  right: ParsedDoc;
  /** Currently-selected diff (drives row outline + initial scroll). */
  selectedDiff?: SelectedDiff | null;
  /** Block-row click handler — passes (side, docId, blockId, kind). */
  onBlockClick?: (
    side: "left" | "right",
    docId: string,
    blockId: string | undefined,
    kind: DiffKind,
  ) => void;
  /** Jaccard threshold for the text-similarity fallback. Default 0.7. */
  textSimilarityThreshold?: number;
}

export interface SideBySideDocViewerHandle {
  /** Scroll both panes to the row containing the given block_ids. Returns
   *  true if a matching row was found and scrolled. */
  scrollToBlockIds: (left?: string, right?: string) => boolean;
}

const DIFF_BG: Record<DiffKind, string> = {
  unchanged: "border-l-transparent",
  modified: "border-l-amber-400 bg-amber-50/40",
  added: "border-l-emerald-400 bg-emerald-50/40",
  removed: "border-l-rose-400 bg-rose-50/40",
};

export const SideBySideDocViewer = forwardRef<SideBySideDocViewerHandle, SideBySideDocViewerProps>(
  function SideBySideDocViewer(
    { left, right, selectedDiff, onBlockClick, textSimilarityThreshold },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [leftFraction, setLeftFraction] = useState(0.5);
    const { leftRef, rightRef } = useSyncedScroll();

    const aligned = useMemo<AlignedRow[]>(
      () => alignBlocks(left.blocks, right.blocks, { textSimilarityThreshold }),
      [left.blocks, right.blocks, textSimilarityThreshold],
    );

    // Map each row to a stable DOM id so the imperative scroll API can
    // locate the right node on either side without re-running the algorithm.
    const rowIds = useMemo(
      () =>
        aligned.map((row, idx) => ({
          left: `sbs-left-${idx}`,
          right: `sbs-right-${idx}`,
          row,
        })),
      [aligned],
    );

    useImperativeHandle(
      ref,
      () => ({
        scrollToBlockIds(leftBlockId, rightBlockId) {
          const target = rowIds.find(
            ({ row }) =>
              (leftBlockId && row.left?.block_id === leftBlockId) ||
              (rightBlockId && row.right?.block_id === rightBlockId),
          );
          if (!target) return false;
          const leftNode = leftRef.current?.querySelector?.(`[data-row-id="${target.left}"]`);
          const rightNode = rightRef.current?.querySelector?.(`[data-row-id="${target.right}"]`);
          // scrollIntoView is missing in jsdom and in some headless test harnesses
          // — defensive optional-call covers both. In prod browsers both branches fire.
          leftNode?.scrollIntoView?.({ block: "center", behavior: "smooth" });
          rightNode?.scrollIntoView?.({ block: "center", behavior: "smooth" });
          return true;
        },
      }),
      [rowIds, leftRef, rightRef],
    );

    return (
      <div
        ref={containerRef}
        data-testid="side-by-side-doc-viewer"
        className="flex h-full w-full overflow-hidden"
      >
        <Pane
          side="left"
          docId={left.docId}
          filename={left.filename}
          rowIds={rowIds}
          selectedDiff={selectedDiff}
          onBlockClick={onBlockClick}
          scrollRef={leftRef}
          flex={leftFraction}
        />
        <WorkspaceDivider
          currentFraction={leftFraction}
          onFractionChange={setLeftFraction}
          containerRef={containerRef}
          minFraction={0.2}
          maxFraction={0.8}
        />
        <Pane
          side="right"
          docId={right.docId}
          filename={right.filename}
          rowIds={rowIds}
          selectedDiff={selectedDiff}
          onBlockClick={onBlockClick}
          scrollRef={rightRef}
          flex={1 - leftFraction}
        />
      </div>
    );
  },
);

interface PaneProps {
  side: "left" | "right";
  docId: string;
  filename?: string;
  rowIds: Array<{ left: string; right: string; row: AlignedRow }>;
  selectedDiff?: SelectedDiff | null;
  onBlockClick?: SideBySideDocViewerProps["onBlockClick"];
  scrollRef: React.RefObject<HTMLElement | null>;
  flex: number;
}

function Pane({ side, docId, filename, rowIds, selectedDiff, onBlockClick, scrollRef, flex }: PaneProps) {
  const setScrollRef = (node: HTMLDivElement | null) => {
    (scrollRef as React.MutableRefObject<HTMLElement | null>).current = node;
  };

  return (
    <div
      className="flex h-full min-w-0 flex-col"
      style={{ flexBasis: `${flex * 100}%` }}
      data-testid={`side-by-side-pane-${side}`}
    >
      <div className="border-b border-gray-200 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-600">
        {filename ?? docId}
      </div>
      <div
        ref={setScrollRef}
        className="flex-1 overflow-y-auto"
        data-testid={`side-by-side-scroll-${side}`}
      >
        {rowIds.map(({ left, right, row }, idx) => {
          const block = side === "left" ? row.left : row.right;
          const rowId = side === "left" ? left : right;
          const isFocused =
            block &&
            selectedDiff &&
            ((side === "left" && selectedDiff.leftBlockId === block.block_id) ||
              (side === "right" && selectedDiff.rightBlockId === block.block_id));

          if (!block) {
            // Placeholder so both sides stay vertically aligned even when one side
            // has an inserted/removed block. Empty cell preserves the diff position.
            return (
              <div
                key={`${rowId}-empty`}
                data-row-id={rowId}
                data-diff-kind={row.kind}
                aria-hidden="true"
                className={`border-l-2 border-dashed border-gray-200 px-3 py-2 text-xs text-gray-300 ${
                  row.kind === "removed" ? "italic" : ""
                }`}
              >
                {row.kind === "added" && side === "left" ? "(added on right)" : ""}
                {row.kind === "removed" && side === "right" ? "(removed from left)" : ""}
              </div>
            );
          }

          return (
            <div
              key={rowId}
              data-row-id={rowId}
              data-diff-kind={row.kind}
              data-block-id={block.block_id ?? ""}
              onClick={() => onBlockClick?.(side, docId, block.block_id, row.kind)}
              className={`cursor-pointer border-l-2 px-3 py-2 transition ${DIFF_BG[row.kind]} ${
                isFocused ? "ring-2 ring-teal-400 ring-offset-1" : ""
              }`}
            >
              <BlocksRenderer blocks={[blockAsBlocksRendererInput(block, idx)]} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Bridge AlignableBlock → Block (the BlocksRenderer input shape). They
// overlap structurally — both use {type, text, headers, rows, items, etc.}
// but TS doesn't know that. We narrow the cast at this boundary so the
// rest of the component can stay in AlignableBlock land.
function blockAsBlocksRendererInput(block: AlignableBlock, _idx: number): Block {
  return block as unknown as Block;
}
