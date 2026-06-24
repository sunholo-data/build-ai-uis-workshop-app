import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { createRef } from "react";

import { SideBySideDocViewer, type SideBySideDocViewerHandle } from "../SideBySideDocViewer";
import type { AlignableBlock } from "@/lib/diff/blockAlign";

function block(text: string, block_id?: string, type = "paragraph"): AlignableBlock {
  return { text, block_id, type };
}

describe("SideBySideDocViewer", () => {
  it("renders both panes with filenames in the header bars", () => {
    render(
      <SideBySideDocViewer
        left={{ docId: "doc-A", filename: "Contract A.pdf", blocks: [block("Hello", "blk-1")] }}
        right={{ docId: "doc-B", filename: "Contract B.pdf", blocks: [block("Hello", "blk-1")] }}
      />,
    );
    expect(screen.getByTestId("side-by-side-pane-left")).toHaveTextContent("Contract A.pdf");
    expect(screen.getByTestId("side-by-side-pane-right")).toHaveTextContent("Contract B.pdf");
  });

  it("renders unchanged blocks with no diff styling and modified blocks with amber", () => {
    render(
      <SideBySideDocViewer
        left={{ docId: "doc-A", blocks: [block("identical", "blk-1"), block("Buyer pays €45", "blk-2")] }}
        right={{
          docId: "doc-B",
          blocks: [block("identical", "blk-1"), block("Buyer pays CPI-indexed price", "blk-2")],
        }}
      />,
    );

    const leftRows = screen.getByTestId("side-by-side-scroll-left").querySelectorAll("[data-row-id]");
    expect(leftRows.length).toBe(2);
    expect(leftRows[0].getAttribute("data-diff-kind")).toBe("unchanged");
    expect(leftRows[1].getAttribute("data-diff-kind")).toBe("modified");
  });

  it("renders placeholder rows for added/removed blocks to keep panes vertically aligned", () => {
    render(
      <SideBySideDocViewer
        left={{ docId: "doc-A", blocks: [block("only on left")] }}
        right={{ docId: "doc-B", blocks: [block("only on right")] }}
        textSimilarityThreshold={0.95}
      />,
    );

    const leftRows = screen.getByTestId("side-by-side-scroll-left").querySelectorAll("[data-row-id]");
    const rightRows = screen.getByTestId("side-by-side-scroll-right").querySelectorAll("[data-row-id]");
    expect(leftRows.length).toBe(2);
    expect(rightRows.length).toBe(2);
    // First left row = the only-on-left block (removed); second is the placeholder (added)
    expect(leftRows[0].getAttribute("data-diff-kind")).toBe("removed");
    expect(leftRows[1].getAttribute("data-diff-kind")).toBe("added");
    expect(leftRows[1].textContent).toMatch(/added on right/);
  });

  it("fires onBlockClick with (side, docId, block_id, kind) when a block is clicked", () => {
    const onClick = vi.fn();
    render(
      <SideBySideDocViewer
        left={{ docId: "doc-A", blocks: [block("Hello", "blk-1")] }}
        right={{ docId: "doc-B", blocks: [block("Hello", "blk-1")] }}
        onBlockClick={onClick}
      />,
    );
    const leftBlock = screen
      .getByTestId("side-by-side-scroll-left")
      .querySelector('[data-block-id="blk-1"]') as HTMLElement;
    fireEvent.click(leftBlock);
    expect(onClick).toHaveBeenCalledWith("left", "doc-A", "blk-1", "unchanged");
  });

  it("applies focused ring outline when selectedDiff matches the row's block_id", () => {
    render(
      <SideBySideDocViewer
        left={{ docId: "doc-A", blocks: [block("first", "blk-1"), block("price € 45", "blk-2")] }}
        right={{ docId: "doc-B", blocks: [block("first", "blk-1"), block("price CPI-indexed", "blk-2")] }}
        selectedDiff={{ clauseName: "price_formula", leftBlockId: "blk-2", rightBlockId: "blk-2" }}
      />,
    );
    const leftFocused = screen
      .getByTestId("side-by-side-scroll-left")
      .querySelector('[data-block-id="blk-2"]') as HTMLElement;
    expect(leftFocused.className).toContain("ring-2");
  });

  it("exposes scrollToBlockIds via ref; returns true when the row exists", () => {
    const ref = createRef<SideBySideDocViewerHandle>();
    render(
      <SideBySideDocViewer
        ref={ref}
        left={{ docId: "doc-A", blocks: [block("settlement", "blk-set"), block("price", "blk-price")] }}
        right={{ docId: "doc-B", blocks: [block("settlement", "blk-set"), block("price", "blk-price")] }}
      />,
    );
    expect(ref.current?.scrollToBlockIds("blk-price")).toBe(true);
    expect(ref.current?.scrollToBlockIds("blk-unknown")).toBe(false);
  });
});
