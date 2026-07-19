export type DocType = "sop" | "ra" | "hmp" | "proposal";

/** "derived" = produced deterministically from the client's brand kit — no model call. */
export type EngineId = "api" | "cli" | "gateway" | "derived";

export interface ExtractionMeta {
  field_confidence: {
    field: string;
    level: "high" | "medium" | "low";
    note: string;
    /** Short verbatim source snippet evidencing the value — provenance for the reviewer. */
    quote?: string;
  }[];
  not_found: string[];
  warnings: string[];
}

export interface ExtractionResult {
  document: Record<string, unknown>;
  meta: ExtractionMeta;
}

/**
 * Client-level styling distilled from a finalised template build: the shared
 * brand identity (colours, fonts, cover treatment, tables) minus anything
 * doc-type specific. Templates for other doc types compile deterministically
 * from this — no AI round, guaranteed visual consistency across the set.
 */
export interface BrandKit {
  typography: TemplateSpec["typography"];
  colors: TemplateSpec["colors"];
  cover: Omit<TemplateSpec["cover"], "subtitle_text">;
  headings: TemplateSpec["headings"];
  tables: TemplateSpec["tables"];
  spacing: TemplateSpec["spacing"];
  /** The finalised build whose styling this is (provenance). */
  derivedFrom: { buildId: string; docType: DocType; finalizedAt: string };
  /** Stored logo filename inside the source build's files, if one was uploaded. */
  logoFilename: string | null;
}

export interface ClientRecord {
  id: string;
  name: string;
  createdAt: string;
  /** Per-doc-type custom templates; absent doc types fall back to the master template. */
  templates: Partial<Record<DocType, { filename: string; uploadedAt: string }>>;
  /** Refreshed every time a build is finalised — the latest finalised styling wins. */
  brandKit?: BrandKit | null;
}

/** A reviewer's pre-approval correction to one extracted field (audit trail). */
export interface RunAmendment {
  field: string;
  at: string;
  /** The model's original value, kept for the audit record. */
  previous: unknown;
}

export interface RunRecord {
  id: string;
  createdAt: string;
  /**
   * generating: extraction runs in the background after the create response.
   * awaiting_review: extracted, render gated on human approval.
   * complete: approved + rendered.
   */
  status: "generating" | "awaiting_review" | "complete" | "failed";
  /** Set while extraction runs in the background; null otherwise. */
  generationStartedAt?: string | null;
  /** Heartbeat for stale-run rescue; bumped on every state change. */
  updatedAt?: string;
  approval: { approvedBy: string; at: string } | null;
  /** Reviewer corrections applied before approval, newest last. */
  amendments?: RunAmendment[];
  /** Set when this run is part of an Anthropic Message Batch (bulk mode, 50% token pricing). */
  batchId?: string | null;
  /** Set when the run is tied to a registered client (enables their custom template). */
  clientId: string | null;
  clientName: string;
  docType: DocType;
  /** The specific built template chosen for this run; null/absent -> client default or master. */
  templateBuildId?: string | null;
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

/** A guided template build: brand materials in, reviewed branded template out. */
export type BuildStatus = "generating" | "review" | "final" | "failed";

export type BuildProvider = "anthropic" | "google" | "openai";

export interface BuildMaterialFile {
  filename: string;
  bytes: number;
}

export interface BuildMaterials {
  logo: BuildMaterialFile | null;
  fonts: BuildMaterialFile[];
  styleGuides: BuildMaterialFile[];
  /** 1–3 exemplar documents showing how the client wants the output to look. */
  references: BuildMaterialFile[];
}

export interface SectionFeedback {
  sectionId: string;
  comment: string;
}

export interface BuildIteration {
  version: number;
  createdAt: string;
  /** Wall-clock time the design round took; feeds progress estimates. */
  durationMs?: number;
  spec: TemplateSpec;
  engine: EngineId;
  model: string;
  usage: RunRecord["usage"];
  costUsd: number | null;
  /** Review submitted against this version; null until the user submits one. */
  feedback: SectionFeedback[] | null;
  reviewedAt: string | null;
}

export interface TemplateBuildRecord {
  id: string;
  clientId: string;
  clientName: string;
  docType: DocType;
  /** User-facing template name; renameable. Clients can hold several per doc type. */
  name: string;
  createdAt: string;
  /** Heartbeat for stale-build rescue; bumped on every state change. */
  updatedAt?: string;
  status: BuildStatus;
  /** Set while a design round runs in the background; null otherwise. */
  generationStartedAt?: string | null;
  /** The user's message describing how the template should look. */
  brief: string;
  provider: BuildProvider;
  model: string;
  materials: BuildMaterials;
  iterations: BuildIteration[];
  final: { finalizedAt: string; templateFilename: string } | null;
  error: string | null;
}

export const MAX_REVIEW_ROUNDS = 5;

/** Layout/styling decisions the design model makes; content stays out of scope. */
export interface TemplateSpec {
  design_rationale: string;
  typography: { heading_font: string; body_font: string; base_size_pt: number };
  colors: {
    accent: string;
    table_header_fill: string;
    table_border: string;
    muted_text: string;
  };
  cover: {
    style: "centered" | "left" | "banner";
    show_logo: boolean;
    logo_height_pt: number;
    title_size_pt: number;
    subtitle_text: string;
    show_rule: boolean;
  };
  headings: { numbered: boolean; uppercase: boolean; size_pt: number; underline_rule: boolean };
  tables: { style: "grid" | "striped" | "minimal"; header_text_color: string; border_weight: "hairline" | "light" | "medium" };
  spacing: "compact" | "regular" | "airy";
  sections: { id: string; title: string }[];
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
