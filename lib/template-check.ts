import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import type { DocType } from "./types";

const COMMON = {
  title: "Sample Document",
  doc_number: "DOC-001",
  revision: "1",
  client_name: "Sample Client",
  site: "Sample Site",
  effective_date: "1 Jan 2026",
  review_date: "1 Jan 2027",
  purpose: "Sample purpose.",
  scope: "Sample scope.",
  references: ["Sample reference"],
  generated_at: "2026-01-01T00:00:00Z",
  review_warnings: ["Sample warning"],
  has_review_warnings: true,
};

/** Minimal valid render data per doc type, used to dry-run uploaded templates. */
export const TEMPLATE_DUMMY_DATA: Record<DocType, Record<string, unknown>> = {
  sop: {
    ...COMMON,
    definitions: [{ term: "Term", definition: "Definition" }],
    responsibilities: [{ role: "Role", duties: "Duties" }],
    ppe_requirements: ["Hard hat"],
    procedure_steps: [{ step_number: "1", instruction: "Do the thing.", warning: "" }],
    hazards: [{ hazard: "Hazard", risk_level: "High", controls: "Controls" }],
  },
  ra: {
    ...COMMON,
    activity: "Sample activity",
    assessment_date: "1 Jan 2026",
    assessors: ["A. Person"],
    methodology: "Sample methodology.",
    risk_items: [
      {
        hazard: "Hazard",
        associated_risk: "Risk",
        initial_risk: "High",
        controls: "Controls",
        residual_risk: "Low",
        control_owner: "Owner",
      },
    ],
  },
  hmp: {
    ...COMMON,
    hazard_category: "Sample category",
    hazard_description: "Sample description.",
    controls: [{ control: "Control", type: "Engineering", owner: "Owner" }],
    monitoring: [{ activity: "Activity", frequency: "Weekly", responsible: "Person" }],
    responsibilities: [{ role: "Role", duties: "Duties" }],
    trigger_action_responses: [{ trigger: "Trigger", level: "Amber", response: "Response" }],
  },
  proposal: {
    ...COMMON,
    proposal_number: "P-001",
    date: "1 Jan 2026",
    client_contact: "A. Contact",
    prepared_by: "Preparer",
    validity: "30 days",
    executive_summary: "Summary.",
    background: "Background.",
    objectives: ["Objective"],
    scope_of_work: [{ item: "Item", description: "Description" }],
    deliverables: [{ name: "Deliverable", description: "Description" }],
    approach: [{ phase: "Phase 1", description: "Description", duration: "1 week" }],
    timeline: [{ milestone: "Milestone", date: "1 Feb 2026" }],
    team: [{ name: "Name", role: "Role", experience: "Experience" }],
    pricing: [{ item: "Item", amount: "$100", notes: "" }],
    assumptions: ["Assumption"],
    exclusions: ["Exclusion"],
    terms: "Terms.",
  },
};

/**
 * Dry-run render an uploaded template against dummy data. Returns null on
 * success, or a human-readable explanation of every broken tag on failure —
 * a client template is rejected at upload time, never at approval time.
 */
export function validateTemplate(docType: DocType, templateBuffer: Buffer): string | null {
  try {
    const zip = new PizZip(templateBuffer);
    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, nullGetter: () => "" });
    doc.render(TEMPLATE_DUMMY_DATA[docType]);
    return null;
  } catch (e) {
    const err = e as Error & { properties?: { errors?: { properties?: { explanation?: string } }[] } };
    const details = err.properties?.errors
      ?.map((x) => x.properties?.explanation)
      .filter(Boolean)
      .join("; ");
    return details || err.message || "Template could not be rendered";
  }
}
