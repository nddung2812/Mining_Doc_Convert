import fs from "fs";
import path from "path";
import type { DocType, TemplateSpec } from "./types";
import { DOC_TYPE_NAMES } from "./types";

/**
 * The reviewable units of a built template. The id set per doc type is fixed —
 * custom sections are schema changes that need expert sign-off, so the design
 * model may restyle, retitle, and reorder content sections but never add or
 * remove them. Cover and document-info always lead; the reviewer-checklist
 * block and compliance footer are mandatory and outside the spec entirely.
 */
export interface SectionDef {
  id: string;
  defaultTitle: string;
  /** What the section holds — context for the design model and the reviewer. */
  hint: string;
}

const COVER: SectionDef = { id: "cover", defaultTitle: "Cover", hint: "Client name, logo, document title block." };
const DOC_INFO: SectionDef = {
  id: "doc_info",
  defaultTitle: "Document Information",
  hint: "Document number, revision, dates — the controlled-document metadata table.",
};

const CONTENT_SECTIONS: Record<DocType, SectionDef[]> = {
  sop: [
    { id: "purpose", defaultTitle: "Purpose", hint: "Why this procedure exists (paragraph)." },
    { id: "scope", defaultTitle: "Scope", hint: "Where and to whom it applies (paragraph)." },
    { id: "definitions", defaultTitle: "Definitions", hint: "Term/definition table." },
    { id: "responsibilities", defaultTitle: "Responsibilities", hint: "Role/duties table." },
    { id: "ppe_requirements", defaultTitle: "PPE Requirements", hint: "Bulleted equipment list." },
    { id: "hazards", defaultTitle: "Hazards and Controls", hint: "Hazard / risk level / controls table." },
    { id: "procedure", defaultTitle: "Procedure", hint: "Numbered steps, each may carry a warning." },
    { id: "references", defaultTitle: "References", hint: "Bulleted list of referenced documents." },
  ],
  ra: [
    { id: "assessment_team", defaultTitle: "Assessment Team", hint: "Bulleted list of assessors." },
    { id: "methodology", defaultTitle: "Methodology", hint: "How the assessment was performed (paragraph)." },
    { id: "risk_register", defaultTitle: "Risk Register", hint: "Wide hazard/risk/controls/residual table — the heart of the RA." },
    { id: "references", defaultTitle: "References", hint: "Bulleted list of referenced documents." },
  ],
  hmp: [
    { id: "purpose", defaultTitle: "Purpose", hint: "Why this plan exists (paragraph)." },
    { id: "scope", defaultTitle: "Scope", hint: "Where and to whom it applies (paragraph)." },
    { id: "hazard_description", defaultTitle: "Hazard Description", hint: "The principal hazard described (paragraph)." },
    { id: "controls", defaultTitle: "Control Measures", hint: "Control / hierarchy type / owner table." },
    { id: "monitoring", defaultTitle: "Monitoring and Inspection", hint: "Activity / frequency / responsible table." },
    { id: "responsibilities", defaultTitle: "Responsibilities", hint: "Role/duties table." },
    { id: "tarp", defaultTitle: "Trigger Action Response Plan (TARP)", hint: "Trigger / level / response table." },
    { id: "references", defaultTitle: "References", hint: "Bulleted list of referenced documents." },
  ],
  proposal: [
    { id: "executive_summary", defaultTitle: "Executive Summary", hint: "The pitch in one section (paragraph)." },
    { id: "background", defaultTitle: "Background", hint: "Context for the engagement (paragraph)." },
    { id: "objectives", defaultTitle: "Objectives", hint: "Bulleted objectives list." },
    { id: "scope_of_work", defaultTitle: "Scope of Work", hint: "Item/description table." },
    { id: "deliverables", defaultTitle: "Deliverables", hint: "Deliverable/description table." },
    { id: "approach", defaultTitle: "Approach", hint: "Phased approach: phase, duration, description blocks." },
    { id: "timeline", defaultTitle: "Timeline", hint: "Milestone/date table." },
    { id: "team", defaultTitle: "Team", hint: "Name / role / experience table." },
    { id: "pricing", defaultTitle: "Investment", hint: "Item / amount / notes table — commercially critical." },
    { id: "assumptions", defaultTitle: "Assumptions", hint: "Bulleted list." },
    { id: "exclusions", defaultTitle: "Exclusions", hint: "Bulleted list." },
    { id: "terms", defaultTitle: "Terms", hint: "Terms and conditions (paragraph)." },
  ],
};

export function sectionCatalog(docType: DocType): SectionDef[] {
  return [COVER, DOC_INFO, ...CONTENT_SECTIONS[docType]];
}

export function defaultSpec(docType: DocType): TemplateSpec {
  return {
    design_rationale: "House default: deep navy accent, Calibri, grid tables — the master template look.",
    typography: { heading_font: "Calibri", body_font: "Calibri", base_size_pt: 11 },
    colors: { accent: "1F3A5F", table_header_fill: "E8EDF4", table_border: "9FB3CC", muted_text: "666666" },
    cover: {
      style: "centered",
      show_logo: true,
      logo_height_pt: 60,
      title_size_pt: 26,
      subtitle_text: DOC_TYPE_NAMES[docType],
      show_rule: false,
    },
    headings: { numbered: true, uppercase: false, size_pt: 13, underline_rule: false },
    tables: { style: "grid", header_text_color: "1F3A5F", border_weight: "light" },
    spacing: "regular",
    sections: sectionCatalog(docType).map((s) => ({ id: s.id, title: s.defaultTitle })),
  };
}

const SPEC_SCHEMA_PATH = path.join(process.cwd(), "schemas", "template-spec.schema.json");
let specSchemaCache: { schema: Record<string, unknown>; version: string } | null = null;

/** The on-disk schema, stripped of metadata keywords the model APIs reject. */
export function getSpecSchema(): { schema: Record<string, unknown>; version: string } {
  if (!specSchemaCache) {
    const raw = JSON.parse(fs.readFileSync(SPEC_SCHEMA_PATH, "utf8")) as Record<string, unknown>;
    const version = typeof raw.version === "string" ? raw.version : "unknown";
    delete raw.version;
    delete raw.$id;
    specSchemaCache = { schema: raw, version };
  }
  return specSchemaCache;
}

function hex(value: unknown, fallback: string): string {
  const s = String(value ?? "").replace(/^#/, "").toUpperCase();
  return /^[0-9A-F]{6}$/.test(s) ? s : fallback;
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

function str(value: unknown, fallback: string, maxLen = 120): string {
  const s = String(value ?? "").trim();
  return s ? s.slice(0, maxLen) : fallback;
}

function pick<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

/**
 * Whatever the model returned, the spec that leaves here is safe to compile:
 * numbers clamped, colors valid hex, enums checked, and the section list
 * reconciled against the fixed catalog (cover/doc-info first, missing sections
 * restored in default order, unknown ids dropped).
 */
export function normalizeSpec(docType: DocType, raw: unknown): TemplateSpec {
  const d = defaultSpec(docType);
  const r = (raw ?? {}) as Record<string, Record<string, unknown>> & Record<string, unknown>;
  const typography = (r.typography ?? {}) as Record<string, unknown>;
  const colors = (r.colors ?? {}) as Record<string, unknown>;
  const cover = (r.cover ?? {}) as Record<string, unknown>;
  const headings = (r.headings ?? {}) as Record<string, unknown>;
  const tables = (r.tables ?? {}) as Record<string, unknown>;

  const catalog = sectionCatalog(docType);
  const byId = new Map(catalog.map((s) => [s.id, s]));
  const proposed = Array.isArray(r.sections) ? (r.sections as { id?: unknown; title?: unknown }[]) : [];
  const seen = new Set<string>();
  const ordered: { id: string; title: string }[] = [];
  for (const entry of proposed) {
    const id = String(entry?.id ?? "");
    const def = byId.get(id);
    if (!def || seen.has(id)) continue;
    seen.add(id);
    ordered.push({ id, title: str(entry?.title, def.defaultTitle, 80) });
  }
  for (const def of catalog) {
    if (!seen.has(def.id)) ordered.push({ id: def.id, title: def.defaultTitle });
  }
  // Cover and document info always lead, in that order.
  const lead = ["cover", "doc_info"];
  const sections = [
    ...lead.map((id) => ordered.find((s) => s.id === id)!),
    ...ordered.filter((s) => !lead.includes(s.id)),
  ];

  return {
    design_rationale: str(r.design_rationale, "", 2000) || d.design_rationale,
    typography: {
      heading_font: str(typography.heading_font, d.typography.heading_font, 60),
      body_font: str(typography.body_font, d.typography.body_font, 60),
      base_size_pt: clamp(typography.base_size_pt, 9, 13, d.typography.base_size_pt),
    },
    colors: {
      accent: hex(colors.accent, d.colors.accent),
      table_header_fill: hex(colors.table_header_fill, d.colors.table_header_fill),
      table_border: hex(colors.table_border, d.colors.table_border),
      muted_text: hex(colors.muted_text, d.colors.muted_text),
    },
    cover: {
      style: pick(cover.style, ["centered", "left", "banner"] as const, d.cover.style),
      show_logo: cover.show_logo !== false,
      logo_height_pt: clamp(cover.logo_height_pt, 30, 120, d.cover.logo_height_pt),
      title_size_pt: clamp(cover.title_size_pt, 20, 36, d.cover.title_size_pt),
      subtitle_text: str(cover.subtitle_text, d.cover.subtitle_text, 80),
      show_rule: cover.show_rule === true,
    },
    headings: {
      numbered: headings.numbered !== false,
      uppercase: headings.uppercase === true,
      size_pt: clamp(headings.size_pt, 12, 18, d.headings.size_pt),
      underline_rule: headings.underline_rule === true,
    },
    tables: {
      style: pick(tables.style, ["grid", "striped", "minimal"] as const, d.tables.style),
      header_text_color: hex(tables.header_text_color, d.tables.header_text_color),
      border_weight: pick(tables.border_weight, ["hairline", "light", "medium"] as const, d.tables.border_weight),
    },
    spacing: pick(r.spacing, ["compact", "regular", "airy"] as const, d.spacing),
    sections,
  };
}
