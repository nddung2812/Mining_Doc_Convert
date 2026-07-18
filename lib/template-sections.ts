import type { DocType } from "./types";

/**
 * The docxtemplater wiring for every section of every doc type — the single
 * source of truth shared by the .docx compiler and the HTML preview. The tags
 * here must stay identical to the master templates (templates/*.docx) so a
 * built template drops straight into the existing render pipeline.
 */
export type SectionBody =
  | { kind: "cover" }
  | { kind: "meta"; rows: [label: string, tag: string][] }
  | { kind: "paragraph"; tag: string }
  | { kind: "bullets"; loop: string }
  | { kind: "table"; loop: string; columns: { header: string; tag: string }[] }
  | { kind: "steps" }
  | { kind: "approach" };

export const SECTION_BODIES: Record<DocType, Record<string, SectionBody>> = {
  sop: {
    cover: { kind: "cover" },
    doc_info: {
      kind: "meta",
      rows: [
        ["Document number", "{doc_number}"],
        ["Revision", "{revision}"],
        ["Site", "{site}"],
        ["Effective date", "{effective_date}"],
        ["Next review date", "{review_date}"],
      ],
    },
    purpose: { kind: "paragraph", tag: "{purpose}" },
    scope: { kind: "paragraph", tag: "{scope}" },
    definitions: {
      kind: "table",
      loop: "definitions",
      columns: [
        { header: "Term", tag: "{term}" },
        { header: "Definition", tag: "{definition}" },
      ],
    },
    responsibilities: {
      kind: "table",
      loop: "responsibilities",
      columns: [
        { header: "Role", tag: "{role}" },
        { header: "Duties", tag: "{duties}" },
      ],
    },
    ppe_requirements: { kind: "bullets", loop: "ppe_requirements" },
    hazards: {
      kind: "table",
      loop: "hazards",
      columns: [
        { header: "Hazard", tag: "{hazard}" },
        { header: "Risk level", tag: "{risk_level}" },
        { header: "Controls", tag: "{controls}" },
      ],
    },
    procedure: { kind: "steps" },
    references: { kind: "bullets", loop: "references" },
  },
  ra: {
    cover: { kind: "cover" },
    doc_info: {
      kind: "meta",
      rows: [
        ["Document number", "{doc_number}"],
        ["Revision", "{revision}"],
        ["Site", "{site}"],
        ["Activity assessed", "{activity}"],
        ["Assessment date", "{assessment_date}"],
      ],
    },
    assessment_team: { kind: "bullets", loop: "assessors" },
    methodology: { kind: "paragraph", tag: "{methodology}" },
    risk_register: {
      kind: "table",
      loop: "risk_items",
      columns: [
        { header: "Hazard", tag: "{hazard}" },
        { header: "Associated risk", tag: "{associated_risk}" },
        { header: "Initial risk", tag: "{initial_risk}" },
        { header: "Controls", tag: "{controls}" },
        { header: "Residual risk", tag: "{residual_risk}" },
        { header: "Owner", tag: "{control_owner}" },
      ],
    },
    references: { kind: "bullets", loop: "references" },
  },
  hmp: {
    cover: { kind: "cover" },
    doc_info: {
      kind: "meta",
      rows: [
        ["Document number", "{doc_number}"],
        ["Revision", "{revision}"],
        ["Site", "{site}"],
        ["Principal hazard", "{hazard_category}"],
        ["Effective date", "{effective_date}"],
        ["Next review date", "{review_date}"],
      ],
    },
    purpose: { kind: "paragraph", tag: "{purpose}" },
    scope: { kind: "paragraph", tag: "{scope}" },
    hazard_description: { kind: "paragraph", tag: "{hazard_description}" },
    controls: {
      kind: "table",
      loop: "controls",
      columns: [
        { header: "Control", tag: "{control}" },
        { header: "Hierarchy type", tag: "{type}" },
        { header: "Owner", tag: "{owner}" },
      ],
    },
    monitoring: {
      kind: "table",
      loop: "monitoring",
      columns: [
        { header: "Activity", tag: "{activity}" },
        { header: "Frequency", tag: "{frequency}" },
        { header: "Responsible", tag: "{responsible}" },
      ],
    },
    responsibilities: {
      kind: "table",
      loop: "responsibilities",
      columns: [
        { header: "Role", tag: "{role}" },
        { header: "Duties", tag: "{duties}" },
      ],
    },
    tarp: {
      kind: "table",
      loop: "trigger_action_responses",
      columns: [
        { header: "Trigger", tag: "{trigger}" },
        { header: "Level", tag: "{level}" },
        { header: "Response", tag: "{response}" },
      ],
    },
    references: { kind: "bullets", loop: "references" },
  },
  proposal: {
    cover: { kind: "cover" },
    doc_info: {
      kind: "meta",
      rows: [
        ["Reference", "{proposal_number}"],
        ["Date", "{date}"],
        ["Prepared for", "{client_contact}"],
        ["Prepared by", "{prepared_by}"],
        ["Valid until", "{validity}"],
      ],
    },
    executive_summary: { kind: "paragraph", tag: "{executive_summary}" },
    background: { kind: "paragraph", tag: "{background}" },
    objectives: { kind: "bullets", loop: "objectives" },
    scope_of_work: {
      kind: "table",
      loop: "scope_of_work",
      columns: [
        { header: "Item", tag: "{item}" },
        { header: "Description", tag: "{description}" },
      ],
    },
    deliverables: {
      kind: "table",
      loop: "deliverables",
      columns: [
        { header: "Deliverable", tag: "{name}" },
        { header: "Description", tag: "{description}" },
      ],
    },
    approach: { kind: "approach" },
    timeline: {
      kind: "table",
      loop: "timeline",
      columns: [
        { header: "Milestone", tag: "{milestone}" },
        { header: "Date", tag: "{date}" },
      ],
    },
    team: {
      kind: "table",
      loop: "team",
      columns: [
        { header: "Name", tag: "{name}" },
        { header: "Role", tag: "{role}" },
        { header: "Relevant experience", tag: "{experience}" },
      ],
    },
    pricing: {
      kind: "table",
      loop: "pricing",
      columns: [
        { header: "Item", tag: "{item}" },
        { header: "Amount", tag: "{amount}" },
        { header: "Notes", tag: "{notes}" },
      ],
    },
    assumptions: { kind: "bullets", loop: "assumptions" },
    exclusions: { kind: "bullets", loop: "exclusions" },
    terms: { kind: "paragraph", tag: "{terms}" },
  },
};

export const COMPLIANCE_FOOTER =
  "DRAFT generated {generated_at} — {doc_number} Rev {revision} — not valid until reviewed and approved by a qualified person";
export const PROPOSAL_FOOTER =
  "DRAFT generated {generated_at} — {proposal_number} — pending internal review, not an offer until issued";

export function footerText(docType: DocType): string {
  return docType === "proposal" ? PROPOSAL_FOOTER : COMPLIANCE_FOOTER;
}

/** Realistic-looking stand-in content for the review preview only. */
export const PREVIEW_SAMPLES: Record<string, string[]> = {
  paragraph: [
    "Sample text — your extracted client content will appear here. This preview only demonstrates layout, typography, and colour.",
  ],
  bullets: ["First sample item", "Second sample item", "Third sample item"],
  cell: ["Sample entry", "Sample detail", "Sample value"],
};
