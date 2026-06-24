import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { ClauseExtractionCard } from "../ClauseExtractionCard";
import type { ClauseExtraction, PpaClauses } from "@/types/ppa-clauses";

function makeClause(overrides: Partial<ClauseExtraction> = {}): ClauseExtraction {
  return {
    clause_name: "settlement_type",
    display_name: "Settlement Type",
    value: "PaP",
    raw_excerpt: "settlement shall be Pay-as-Produced",
    block_id: "blk-42",
    confidence: "high",
    notes: null,
    ...overrides,
  };
}

function makeClauses(overrides: Partial<PpaClauses> = {}): PpaClauses {
  return {
    doc_id: "doc-1",
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
    ...overrides,
  };
}

describe("ClauseExtractionCard", () => {
  it("renders the header with doc id and populated count", () => {
    const clauses = makeClauses({
      settlement_type: makeClause(),
      contract_form: makeClause({ clause_name: "contract_form", display_name: "Contract Form", value: "Physical" }),
    });
    render(<ClauseExtractionCard clauses={clauses} />);

    expect(screen.getByText(/PPA Clause Extraction/i)).toBeInTheDocument();
    expect(screen.getByText("doc-1")).toBeInTheDocument();
    expect(screen.getByText(/2 of 12 standard clauses/i)).toBeInTheDocument();
  });

  it("renders populated clauses with value, confidence badge, raw excerpt, and citation", () => {
    const clauses = makeClauses({
      settlement_type: makeClause(),
    });
    render(<ClauseExtractionCard clauses={clauses} />);

    expect(screen.getByText("Settlement Type")).toBeInTheDocument();
    expect(screen.getByText("PaP")).toBeInTheDocument();
    expect(screen.getByText("high")).toBeInTheDocument();
    expect(screen.getByText(/Pay-as-Produced/i)).toBeInTheDocument();
    expect(screen.getByText(/block blk-42/i)).toBeInTheDocument();
  });

  it("clicks the citation chip and fires onCitationClick with (docId, blockId)", () => {
    const onCitationClick = vi.fn();
    const clauses = makeClauses({
      settlement_type: makeClause({ block_id: "blk-99" }),
    });
    render(<ClauseExtractionCard clauses={clauses} onCitationClick={onCitationClick} />);

    fireEvent.click(screen.getByRole("button", { name: /open source block blk-99/i }));
    expect(onCitationClick).toHaveBeenCalledWith("doc-1", "blk-99");
  });

  it("renders notes when present (extractor caveats surface to the user)", () => {
    const clauses = makeClauses({
      price_formula: makeClause({
        clause_name: "price_formula",
        display_name: "Price Formula",
        value: "Fixed €45/MWh",
        notes: "definition references Annex A which is not included",
        confidence: "medium",
      }),
    });
    render(<ClauseExtractionCard clauses={clauses} />);

    expect(screen.getByText(/Note: definition references Annex A/i)).toBeInTheDocument();
    expect(screen.getByText("medium")).toBeInTheDocument();
  });

  it("renders empty state when no standard clauses populated and no other_clauses", () => {
    const clauses = makeClauses();
    render(<ClauseExtractionCard clauses={clauses} />);
    expect(screen.getByText(/No standard PPA clauses were extracted/i)).toBeInTheDocument();
  });

  it("renders other_clauses below the standard fields", () => {
    const clauses = makeClauses({
      settlement_type: makeClause(),
      other_clauses: [
        makeClause({
          clause_name: "custom_hedge",
          display_name: "Custom Hedge Mechanic",
          value: "Quarterly mark-to-market",
          block_id: "blk-200",
        }),
      ],
    });
    render(<ClauseExtractionCard clauses={clauses} />);

    expect(screen.getByText("Custom Hedge Mechanic")).toBeInTheDocument();
    expect(screen.getByText("Quarterly mark-to-market")).toBeInTheDocument();
    // Header content is split across multiple text nodes by React; query the
    // composed text content of the header div instead.
    const matches = screen.getAllByText((_, node) => {
      if (!node) return false;
      // Only check leaf/header div elements, not their ancestors
      const cls = node.getAttribute?.("class") || "";
      if (!cls.includes("text-gray-500")) return false;
      const txt = node.textContent || "";
      return txt.includes("1 of 12 standard clauses populated") && txt.includes("1 additional");
    });
    expect(matches.length).toBeGreaterThan(0);
  });

  it("shows '— not found' italic placeholder when value is null but the clause was attempted (edge: should not render in standard list)", () => {
    // Standard fields with value=null are filtered out of the standard list,
    // but other_clauses entries with value=null can still appear.
    const clauses = makeClauses({
      other_clauses: [
        makeClause({
          clause_name: "rare_clause",
          display_name: "Rare Clause",
          value: null,
          raw_excerpt: "",
          block_id: "",
          confidence: "low",
        }),
      ],
    });
    render(<ClauseExtractionCard clauses={clauses} />);
    expect(screen.getByText(/not found/i)).toBeInTheDocument();
  });
});
