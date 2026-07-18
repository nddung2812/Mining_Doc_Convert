import { describe, expect, it } from "vitest";
import { getDocTypeAssets } from "@/lib/doctypes";

function validRa() {
  return {
    document: {
      title: "Working at Heights RA",
      doc_number: "RA-001",
      revision: "2",
      client_name: "Example Mining Co",
      site: "North Pit",
      activity: "Scaffold erection",
      assessment_date: "2026-07-01",
      assessors: ["J. Smith (HSE Lead)"],
      methodology: "5x5 matrix per AS/NZS ISO 31000",
      risk_items: [
        {
          hazard: "Fall from height",
          associated_risk: "Serious injury or fatality",
          initial_risk: "High (H15)",
          controls: "Harness, edge protection, permits",
          residual_risk: "Medium (M8)",
          control_owner: "Site supervisor",
        },
      ],
      references: ["AS/NZS 1576"],
    },
    meta: {
      field_confidence: [
        { field: "document.title", level: "high", note: "", quote: "Working at Heights RA" },
      ],
      not_found: [],
      warnings: [],
    },
  };
}

describe("ajv schema gate", () => {
  it("accepts a valid extraction (with provenance quote)", () => {
    const { validate } = getDocTypeAssets("ra");
    expect(validate(validRa())).toBe(true);
  });

  it("accepts entries without the optional quote (older model output)", () => {
    const { validate } = getDocTypeAssets("ra");
    const data = validRa();
    delete (data.meta.field_confidence[0] as Record<string, unknown>).quote;
    expect(validate(data)).toBe(true);
  });

  it("rejects a missing required field", () => {
    const { validate } = getDocTypeAssets("ra");
    const data = validRa();
    delete (data.document as Record<string, unknown>).site;
    expect(validate(data)).toBe(false);
  });

  it("rejects an invalid confidence level", () => {
    const { validate } = getDocTypeAssets("ra");
    const data = validRa();
    data.meta.field_confidence[0].level = "certain";
    expect(validate(data)).toBe(false);
  });

  it("rejects hallucinated extra fields", () => {
    const { validate } = getDocTypeAssets("ra");
    const data = validRa();
    (data.document as Record<string, unknown>).invented_field = "should not pass";
    expect(validate(data)).toBe(false);
  });

  it("reports bumped schema and prompt versions", () => {
    for (const docType of ["sop", "ra", "hmp", "proposal"] as const) {
      const assets = getDocTypeAssets(docType);
      expect(assets.schemaVersion).toBe("1.1.0");
      expect(assets.promptVersion).toBe("1.1.0");
      expect(assets.promptText).toContain("quote");
    }
  });
});
