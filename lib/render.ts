import fs from "fs";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import type { DocType, ExtractionResult } from "./types";
import { getDocTypeAssets } from "./doctypes";

export const NOT_FOUND_SENTINEL = "NOT_FOUND";
const NOT_FOUND_DISPLAY = "«NOT FOUND — REVIEW REQUIRED»";

/** Replace NOT_FOUND sentinels with a loud reviewer-facing marker, recursively. */
function markNotFound(value: unknown): unknown {
  if (typeof value === "string") return value === NOT_FOUND_SENTINEL ? NOT_FOUND_DISPLAY : value;
  if (Array.isArray(value)) return value.map(markNotFound);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, markNotFound(v)]));
  }
  return value;
}

/**
 * Deterministic render: extracted JSON + versioned template -> docx buffer. No AI here.
 * Pass `templateBuffer` (a validated client-specific template) to override the master.
 */
export function renderDocx(
  docType: DocType,
  extracted: ExtractionResult,
  generatedAt: string,
  templateBuffer?: Buffer,
): Buffer {
  const { templatePath } = getDocTypeAssets(docType);
  const zip = new PizZip(templateBuffer ?? fs.readFileSync(templatePath));
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: () => NOT_FOUND_DISPLAY,
  });

  const data = {
    ...(markNotFound(extracted.document) as Record<string, unknown>),
    generated_at: generatedAt,
    review_warnings: extracted.meta.warnings,
    has_review_warnings: extracted.meta.warnings.length > 0,
  };

  doc.render(data);
  return doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
}
