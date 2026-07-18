import { createHash, randomUUID } from "crypto";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveEngine, runExtraction, DEFAULT_MODEL } from "../../lib/engine";
import { estimateCostUsd } from "../../lib/cost";
import { getStorage } from "../../lib/storage";
import { getDocTypeAssets } from "../../lib/doctypes";
import { NOT_FOUND_SENTINEL } from "../../lib/render";
import type { RunRecord } from "../../lib/types";

// CODE REVIEW RULE (build plan v2): this tool contains ONE model call, made by
// runExtraction. If extraction ever becomes a loop, Cowork has been rebuilt.

function countNotFound(value: unknown): number {
  if (typeof value === "string") return value === NOT_FOUND_SENTINEL ? 1 : 0;
  if (Array.isArray(value)) return value.reduce((n: number, v) => n + countNotFound(v), 0);
  if (value && typeof value === "object") return Object.values(value).reduce((n: number, v) => n + countNotFound(v), 0);
  return 0;
}

export default defineTool({
  description:
    "Extract raw mining client source content into schema-conformant document JSON (one deterministic structured call). " +
    "Stores the result as a run record and returns the run id plus a review summary. " +
    "The extracted content itself is never returned to the conversation — it flows to `render` through storage.",
  inputSchema: z.object({
    docType: z.enum(["sop", "ra", "hmp", "proposal"]).describe("Document type to produce"),
    clientName: z.string().min(1).describe("Client/company the document is for"),
    sourceText: z.string().min(1).describe("The raw source content, as plain text"),
  }),
  async execute({ docType, clientName, sourceText }) {
    const assets = getDocTypeAssets(docType);
    const output = await runExtraction(
      docType,
      clientName,
      sourceText,
      resolveEngine({ anthropicKey: null, gatewayKey: null }),
    );

    const id = randomUUID();
    const levels = output.extracted.meta.field_confidence;
    const run: RunRecord = {
      id,
      createdAt: new Date().toISOString(),
      status: "awaiting_review",
      approval: null,
      clientId: null,
      clientName,
      docType,
      source: {
        filename: "(eve session input)",
        bytes: Buffer.byteLength(sourceText, "utf8"),
        sha256: createHash("sha256").update(sourceText).digest("hex"),
      },
      promptVersion: assets.promptVersion,
      schemaVersion: assets.schemaVersion,
      templateVersion: assets.templateVersion,
      engine: output.engine,
      model: output.model,
      usage: output.usage,
      costUsd: estimateCostUsd(output),
      extracted: output.extracted,
      validation: { valid: true, errors: [] },
      confidenceSummary: {
        high: levels.filter((f) => f.level === "high").length,
        medium: levels.filter((f) => f.level === "medium").length,
        low: levels.filter((f) => f.level === "low").length,
        notFound: countNotFound(output.extracted.document),
        warnings: output.extracted.meta.warnings.length,
      },
      error: null,
      downloads: [],
    };
    await getStorage().saveRun(run);

    return {
      runId: id,
      status: "awaiting_review",
      confidenceSummary: run.confidenceSummary,
      notFoundFields: output.extracted.meta.not_found,
      warnings: output.extracted.meta.warnings,
      model: output.model ?? DEFAULT_MODEL,
    };
  },
});
