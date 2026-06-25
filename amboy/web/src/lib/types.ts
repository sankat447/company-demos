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
// Function 1 — stored de-identified artifacts.
export interface Artifact {
  id: string; name: string; filename: string; kind: string;
  entities: number; deid_chars: number; created_at: string;
}
export interface ArtifactDetail {
  id: string; name: string; filename: string; deid_text: string;
  highlighted_html: string; entities: number;
}
// Function 2 — comparability of two artifacts.
export interface ComparableField { label: string; a: number | null; b: number | null; unit?: string; }
export interface Comparability {
  comparable: boolean; reason: string; suggested_name: string;
  fields: ComparableField[]; artifact_a: string; artifact_b: string;
  suggested_questions?: string[];
}
// Model Training console.
export interface TrainingStage { key: string; title: string; desc: string; status: string; pct: number; }
export interface TermLine { k: "in" | "out" | "sys" | "ok" | "warn"; t: string; }
export interface TrainingStatus {
  run_id: string | null; status: string; stages: TrainingStage[];
  version: string | null; metrics: Record<string, number>; log: string[];
  terminal?: TermLine[];
}
export interface ModelVersion { version: string; name: string; accuracy: number; classes: number; created_at: string; }
export interface DocCompare { metrics: DocMetric[]; flags?: DocFlag[]; note?: string; }
