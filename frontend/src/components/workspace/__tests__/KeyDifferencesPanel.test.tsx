import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { KeyDifferencesPanel } from "../KeyDifferencesPanel";
import type { ClauseDifference, PpaClauses, PpaComparison } from "@/types/ppa-clauses";

function emptyClauses(doc_id: string): PpaClauses {
  return {
    doc_id,
    counterparty_buyer: null,
    counterparty_seller: null,
    volume_mwh: null,
    term_years: null,
    settlement_type: null,
    contract_form: null,
    price_formula: null,
    rtm_provider: null,
    force_majeure: null,
    change_of_law: null,
    termination: null,
    governing_law: null,
    other_clauses: [],
  };
}

function makeDiff(overrides: Partial<ClauseDifference> = {}): ClauseDifference {
  return {
    clause_name: "settlement_type",
    display_name: "Settlement Type",
    severity: "material",
    left_value: "PaP",
    right_value: "PaN",
    left_block_id: "blk-A-set",
    right_block_id: "blk-B-set",
    commercial_implication:
      "Right contract shifts forecasting-error risk from Buyer to Seller.",
    ...overrides,
  };
}

function makeComparison(diffs: ClauseDifference[]): PpaComparison {
  return {
    left: emptyClauses("doc-A"),
    right: emptyClauses("doc-B"),
    differences: diffs,
  };
}

describe("KeyDifferencesPanel", () => {
  it("renders an empty-state banner when there are no differences", () => {
    render(<KeyDifferencesPanel comparison={makeComparison([])} />);
    expect(screen.getByText(/No material differences/i)).toBeInTheDocument();
  });

  it("renders one row per difference with severity + display_name + implication", () => {
    const diffs = [
      makeDiff({ severity: "material" }),
      makeDiff({
        clause_name: "force_majeure",
        display_name: "Force Majeure",
        severity: "moderate",
        commercial_implication: "Wider FM clause favours the invoking party.",
        left_block_id: "blk-A-fm",
        right_block_id: "blk-B-fm",
      }),
    ];
    render(<KeyDifferencesPanel comparison={makeComparison(diffs)} />);

    expect(screen.getByText("Settlement Type")).toBeInTheDocument();
    expect(screen.getByText("Force Majeure")).toBeInTheDocument();
    expect(screen.getByText("material")).toBeInTheDocument();
    expect(screen.getByText("moderate")).toBeInTheDocument();
    expect(screen.getByText(/forecasting-error risk/i)).toBeInTheDocument();
    expect(screen.getByText(/Wider FM clause/i)).toBeInTheDocument();
  });

  it("sorts diffs by severity — material first, then moderate, then cosmetic", () => {
    const diffs = [
      makeDiff({ severity: "cosmetic", display_name: "Cosmetic One", left_block_id: "x", right_block_id: "y" }),
      makeDiff({ severity: "material", display_name: "Material One", left_block_id: "a", right_block_id: "b" }),
      makeDiff({ severity: "moderate", display_name: "Moderate One", left_block_id: "c", right_block_id: "d" }),
    ];
    render(<KeyDifferencesPanel comparison={makeComparison(diffs)} />);

    const items = screen.getAllByRole("button");
    expect(items[0]).toHaveTextContent("Material One");
    expect(items[1]).toHaveTextContent("Moderate One");
    expect(items[2]).toHaveTextContent("Cosmetic One");
  });

  it("fires onDifferenceClick with the diff payload on row click", () => {
    const onClick = vi.fn();
    const diff = makeDiff();
    render(<KeyDifferencesPanel comparison={makeComparison([diff])} onDifferenceClick={onClick} />);

    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledWith(expect.objectContaining(diff));
  });

  it("expands the row to reveal left/right values + block ids on click", () => {
    const diff = makeDiff();
    const onClick = vi.fn();
    render(<KeyDifferencesPanel comparison={makeComparison([diff])} onDifferenceClick={onClick} />);
    expect(screen.queryByText("PaP")).not.toBeInTheDocument(); // collapsed

    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("PaP")).toBeInTheDocument();
    expect(screen.getByText("PaN")).toBeInTheDocument();
    expect(screen.getByText(/block blk-A-set/)).toBeInTheDocument();
    expect(screen.getByText(/block blk-B-set/)).toBeInTheDocument();
  });

  it("shows the material count in the header when at least one material diff is present", () => {
    const diffs = [
      makeDiff({ severity: "material" }),
      makeDiff({ severity: "cosmetic", clause_name: "x", left_block_id: "x", right_block_id: "y" }),
    ];
    render(<KeyDifferencesPanel comparison={makeComparison(diffs)} />);
    const matches = screen.getAllByText((_, node) => {
      const cls = node?.getAttribute?.("class") || "";
      if (!cls.includes("text-gray-500")) return false;
      const txt = node?.textContent || "";
      return txt.includes("2 clause divergences") && txt.includes("1 material");
    });
    expect(matches.length).toBeGreaterThan(0);
  });
});
