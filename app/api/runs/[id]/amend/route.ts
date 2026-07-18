import { NextRequest, NextResponse } from "next/server";
import { getStorage } from "@/lib/storage";
import { getDocTypeAssets } from "@/lib/doctypes";
import { confidenceSummary } from "@/lib/runs";
import type { ExtractionResult } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Reviewer amendment: correct one extracted field before approval instead of
 * abandoning a 95%-right run. The change must still pass the doc type's ajv
 * schema, and the model's original value is kept in the audit trail.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const storage = getStorage();
  const run = await storage.getRun(id);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  if (run.status !== "awaiting_review" || !run.extracted) {
    return NextResponse.json({ error: `Run is ${run.status} — amendments are only allowed before approval` }, { status: 409 });
  }

  const body = (await request.json().catch(() => null)) as { field?: string; value?: unknown } | null;
  const field = body?.field;
  // hasOwnProperty, not `in` — `in` would accept prototype keys like __proto__.
  if (!field || typeof field !== "string" || !Object.prototype.hasOwnProperty.call(run.extracted.document, field)) {
    return NextResponse.json({ error: "Unknown field" }, { status: 400 });
  }
  if (body === null || !("value" in body)) {
    return NextResponse.json({ error: "Missing value" }, { status: 400 });
  }

  const candidate: ExtractionResult = {
    ...run.extracted,
    document: { ...run.extracted.document, [field]: body.value },
  };
  const { validate } = getDocTypeAssets(run.docType);
  if (!validate(candidate)) {
    const errors = (validate.errors ?? [])
      .map((e) => `${e.instancePath || "/"} ${e.message ?? ""}`)
      .join("; ");
    return NextResponse.json(
      { error: `The amended value does not fit the ${run.docType} schema: ${errors}` },
      { status: 400 },
    );
  }

  run.amendments = [
    ...(run.amendments ?? []),
    { field, at: new Date().toISOString(), previous: run.extracted.document[field] },
  ];
  run.extracted = candidate;
  run.confidenceSummary = confidenceSummary(candidate);
  run.updatedAt = new Date().toISOString();
  await storage.saveRun(run);

  return NextResponse.json({ ok: true, amendments: run.amendments.length });
}
