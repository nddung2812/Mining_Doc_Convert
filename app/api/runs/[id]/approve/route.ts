import { NextRequest, NextResponse } from "next/server";
import { getStorage } from "@/lib/storage";
import { renderDocx } from "@/lib/render";
import { resolveTemplate } from "@/lib/clients";

export const runtime = "nodejs";

/**
 * The human approval gate: a named reviewer approves the extracted content,
 * which releases the (deterministic) render. Mirrors the Eve `approval`
 * primitive so the fallback engine and the Eve agent share one review model.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const storage = getStorage();
  const run = await storage.getRun(id);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  if (run.status !== "awaiting_review" || !run.extracted) {
    return NextResponse.json({ error: `Run is ${run.status}, not awaiting review` }, { status: 409 });
  }

  const { approvedBy } = (await request.json().catch(() => ({}))) as { approvedBy?: string };
  const reviewer = approvedBy?.trim();
  if (!reviewer) return NextResponse.json({ error: "approvedBy (reviewer name) is required" }, { status: 400 });

  const template = await resolveTemplate(run);
  const docx = renderDocx(run.docType, run.extracted, run.createdAt, template.buffer);
  await storage.saveFile(id, "output.docx", docx);

  run.templateVersion = template.versionLabel;
  run.status = "complete";
  run.approval = { approvedBy: reviewer, at: new Date().toISOString() };
  await storage.saveRun(run);

  return NextResponse.json({ ok: true, status: run.status, approval: run.approval });
}
