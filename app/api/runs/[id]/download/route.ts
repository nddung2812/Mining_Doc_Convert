import { NextResponse } from "next/server";
import { getStorage } from "@/lib/storage";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const storage = getStorage();
  const run = await storage.getRun(id);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  if (run.status === "awaiting_review") {
    return NextResponse.json({ error: "This run has not been approved yet — the render is gated on review." }, { status: 409 });
  }

  const docx = await storage.getFile(id, "output.docx");
  if (!docx) return NextResponse.json({ error: "No rendered document for this run" }, { status: 404 });

  // Audit trail: record the download before serving it.
  run.downloads.push({ at: new Date().toISOString() });
  await storage.saveRun(run);

  const filename = `${run.docType.toUpperCase()}-${run.clientName.replace(/[^\w\-]+/g, "_")}-${run.id.slice(0, 8)}-DRAFT.docx`;
  return new NextResponse(new Uint8Array(docx), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
