import { getStorage } from "@/lib/storage";
import { isDocType } from "@/lib/types";
import { blocksToDocx } from "@/lib/blocks-docx";
import type { EditorDoc } from "@/lib/blocks";

export const runtime = "nodejs";
export const maxDuration = 60;

const ID_RE = /^[a-z0-9-]+$/;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; docType: string }> },
) {
  const { id, docType } = await params;
  if (!ID_RE.test(id)) return Response.json({ error: "Invalid client id" }, { status: 400 });
  if (!isDocType(docType)) return Response.json({ error: "Unknown document type" }, { status: 400 });

  const storage = getStorage();
  const buf = await storage.getClientFile(id, `studio-${docType}.json`);
  if (!buf) return Response.json({ error: "Nothing saved in the studio yet." }, { status: 404 });

  let doc: EditorDoc;
  try {
    doc = JSON.parse(buf.toString("utf8")) as EditorDoc;
  } catch {
    return Response.json({ error: "The saved document is corrupt." }, { status: 500 });
  }

  const client = await storage.getClient(id);
  const safeName = (client?.name ?? id).replace(/[^\w.-]+/g, "_");
  const bytes = new Uint8Array(await blocksToDocx(doc));

  return new Response(bytes, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${safeName}-${docType}.docx"`,
      "Cache-Control": "no-store",
    },
  });
}
