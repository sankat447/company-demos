export type Role =
  | "npi-user" | "npi-analyst" | "npi-compliance"
  | "npi-audit" | "npi-admin" | "npi-reveal";

export interface Comparison {
  id: string;
  label: string;
  year_a: number;
  year_b: number;
  status: "indexed" | "indexing" | "empty";
}

export interface ComparisonStatus {
  comparison_id: string;
  status: string;
  entities_tokenized: number;
  facts_extracted: number;
  chunks_indexed: number;
  npi_left_in_index: number;
}

export interface Citation { id: string; source: string; }
export interface ChatMeta {
  citations: Citation[];
  tokens: string[];
  draft: boolean;
  latency_ms?: number;
}

export interface CompareRow {
  metric: string;
  unit: string | null;
  abs_change: number;
  pct_change: number | null;
  direction: "up" | "down" | "flat";
  [k: string]: unknown; // y2024 / y2025 dynamic keys
}
export interface CompareResult { years: number[]; comparison: CompareRow[]; }
export interface Flag {
  code: string; severity: string; metric: string;
  value: number; threshold: number; message: string;
}
// Figures extracted from two uploaded documents (document-stated, not verified).
export interface DocMetric { label: string; a: number; b: number; unit?: string; cite?: string; }
export interface DocFlag { text: string; severity?: string; cite?: string; }
// PII review (step 2): a detected span the human accepts/rejects before tokenizing.
export interface DetectSpan {
  id: string; start: number; end: number; type: string; label: string;
  score: number; source: string; text: string; description: string;
}
export interface DetectResult {
  filename: string; text: string; spans: DetectSpan[];
  highlighted_html: string; counts: { total: number };
}
export interface DocCompare { metrics: DocMetric[]; flags?: DocFlag[]; note?: string; }
