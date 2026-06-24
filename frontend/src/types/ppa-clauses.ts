// Typed mirror of backend/tools/schemas/ppa_clauses.py (v6.4.0 ONE-DEMO M2).
// Kept hand-written rather than generated because the schema is small and
// changes infrequently; generated types add tooling debt for one consumer.
// If the backend Pydantic schema changes, update both sides.

export type Confidence = "high" | "medium" | "low";
export type Severity = "material" | "moderate" | "cosmetic";

export interface ClauseExtraction {
  clause_name: string;
  display_name: string;
  value: string | null;
  raw_excerpt: string;
  block_id: string;
  confidence: Confidence;
  notes: string | null;
}

export interface PpaClauses {
  doc_id: string;
  counterparty_buyer: ClauseExtraction | null;
  counterparty_seller: ClauseExtraction | null;
  volume_mwh: ClauseExtraction | null;
  term_years: ClauseExtraction | null;
  settlement_type: ClauseExtraction | null;
  contract_form: ClauseExtraction | null;
  price_formula: ClauseExtraction | null;
  rtm_provider: ClauseExtraction | null;
  force_majeure: ClauseExtraction | null;
  change_of_law: ClauseExtraction | null;
  termination: ClauseExtraction | null;
  governing_law: ClauseExtraction | null;
  other_clauses: ClauseExtraction[];
}

export interface ClauseDifference {
  clause_name: string;
  display_name: string;
  severity: Severity;
  left_value: string | null;
  right_value: string | null;
  left_block_id: string;
  right_block_id: string;
  commercial_implication: string;
}

export interface PpaComparison {
  left: PpaClauses;
  right: PpaClauses;
  differences: ClauseDifference[];
}
