import { getStorage } from "@/lib/storage";
import { sectionCatalog } from "@/lib/template-spec";
import { DOC_TYPE_NAMES, isDocType, type DocType } from "@/lib/types";
import type { EditorBlock, EditorDoc } from "@/lib/blocks";

export const runtime = "nodejs";

const ID_RE = /^[a-z0-9-]+$/;
const DOC_VERSION = "2.31.6";

/** First-open content for a doc type: a title, and a heading + guidance
 *  paragraph for each section in the fixed catalog. The user edits from here. */
function seedDoc(docType: DocType): EditorDoc {
  const blocks: EditorBlock[] = [
    { type: "header", data: { text: DOC_TYPE_NAMES[docType], level: 1 } },
    {
      type: "paragraph",
      data: {
        text: "This is your starting structure — the standard sections for this document type. Edit any block by hand, reorder them, or add your own.",
      },
    },
  ];
  for (const section of sectionCatalog(docType)) {
    if (section.id === "cover") continue; // the title heading stands in for the cover
    blocks.push({ type: "header", data: { text: section.defaultTitle, level: 2 } });
    blocks.push({ type: "paragraph", data: { text: section.hint } });
  }
  return { blocks, version: DOC_VERSION };
}

function fileName(docType: DocType): string {
  return `studio-${docType}.json`;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; docType: string }> },
) {
  const { id, docType } = await params;
  if (!ID_RE.test(id)) return Response.json({ error: "Invalid client id" }, { status: 400 });
  if (!isDocType(docType)) return Response.json({ error: "Unknown document type" }, { status: 400 });

  const buf = await getStorage().getClientFile(id, fileName(docType));
  if (buf) {
    try {
      const parsed = JSON.parse(buf.toString("utf8")) as EditorDoc;
      if (Array.isArray(parsed.blocks) && parsed.blocks.length > 0) return Response.json(parsed);
    } catch {
      /* corrupt file — fall through to a fresh seed */
    }
  }
  return Response.json(seedDoc(docType));
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string; docType: string }> },
) {
  const { id, docType } = await params;
  if (!ID_RE.test(id)) return Response.json({ error: "Invalid client id" }, { status: 400 });
  if (!isDocType(docType)) return Response.json({ error: "Unknown document type" }, { status: 400 });

  const body = (await req.json().catch(() => null)) as EditorDoc | null;
  if (!body || !Array.isArray(body.blocks)) {
    return Response.json({ error: "Invalid document" }, { status: 400 });
  }
  const doc: EditorDoc = { time: Date.now(), blocks: body.blocks, version: body.version ?? DOC_VERSION };
  await getStorage().saveClientFile(id, fileName(docType), Buffer.from(JSON.stringify(doc, null, 2), "utf8"));
  return Response.json({ ok: true, savedAt: new Date().toISOString() });
}
