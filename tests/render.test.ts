import { describe, expect, it } from "vitest";
import PizZip from "pizzip";
import { renderDocx } from "@/lib/render";
import type { ExtractionResult } from "@/lib/types";

const extraction: ExtractionResult = {
  document: {
    title: "Working at Heights RA",
    doc_number: "RA-001",
    revision: "2",
    client_name: "Example Mining Co",
    site: "North Pit",
    activity: "Scaffold erection",
    assessment_date: "NOT_FOUND",
    assessors: ["J. Smith"],
    methodology: "5x5 matrix",
    risk_items: [
      {
        hazard: "Fall from height",
        associated_risk: "Serious injury",
        initial_risk: "High",
        controls: "Harness and edge protection",
        residual_risk: "Medium",
        control_owner: "NOT_FOUND",
      },
    ],
    references: [],
  },
  meta: { field_confidence: [], not_found: ["document.assessment_date"], warnings: ["Check revision"] },
};

describe("renderDocx", () => {
  it("renders the master RA template and marks every NOT_FOUND loudly", () => {
    const buffer = renderDocx("ra", extraction, "2026-07-18");
    const xml = new PizZip(buffer).file("word/document.xml")!.asText();
    expect(xml).toContain("Working at Heights RA");
    expect(xml).toContain("Fall from height");
    expect(xml).toContain("NOT FOUND — REVIEW REQUIRED");
    expect(xml).not.toContain("NOT_FOUND"); // the raw sentinel never ships
  });
});
