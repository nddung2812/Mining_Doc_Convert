export type DocType = "sop" | "ra" | "hmp" | "proposal";

export type EngineId = "api" | "cli";

export interface ExtractionMeta {
  field_confidence: { field: string; level: "high" | "medium" | "low"; note: string }[];
  not_found: string[];
  warnings: string[];
}

export interface ExtractionResult {
  document: Record<string, unknown>;
  meta: ExtractionMeta;
}

export interface RunRecord {
  id: string;
  createdAt: string;
  status: "complete" | "failed";
  clientName: string;
  docType: DocType;
  source: { filename: string; bytes: number; sha256: string };
  promptVersion: string;
  schemaVersion: string;
  templateVersion: string;
  engine: EngineId;
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
  } | null;
  costUsd: number | null;
  extracted: ExtractionResult | null;
  validation: { valid: boolean; errors: string[] };
  confidenceSummary: { high: number; medium: number; low: number; notFound: number; warnings: number };
  error: string | null;
  downloads: { at: string }[];
}

export const DOC_TYPE_NAMES: Record<DocType, string> = {
  sop: "Standard Operating Procedure",
  ra: "Risk Assessment",
  hmp: "Hazard Management Plan",
  proposal: "Client Proposal",
};

export function isDocType(value: string): value is DocType {
  return value === "sop" || value === "ra" || value === "hmp" || value === "proposal";
}
