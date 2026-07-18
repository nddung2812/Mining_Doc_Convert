import { NextRequest, NextResponse } from "next/server";
import { getStorage } from "@/lib/storage";
import { clientTemplateFilename } from "@/lib/clients";
import { validateTemplate } from "@/lib/template-check";
import { isDocType } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Upload a client-branded template for one doc type. The template is dry-run
 * rendered against dummy data before it is accepted — a broken tag is rejected
 * here with the exact explanation, never discovered at approval time.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const storage = getStorage();
  const client = await storage.getClient(id);
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data" }, { status: 400 });
  }

  const file = form.get("file");
  const docTypeRaw = String(form.get("docType") ?? "");
  if (!(file instanceof File)) return NextResponse.json({ error: "Missing template file" }, { status: 400 });
  if (!isDocType(docTypeRaw)) return NextResponse.json({ error: "Invalid doc type" }, { status: 400 });
  if (!file.name.toLowerCase().endsWith(".docx")) {
    return NextResponse.json({ error: "Template must be a .docx file" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const problem = validateTemplate(docTypeRaw, buffer);
  if (problem) {
    return NextResponse.json(
      {
        error: `Template failed validation: ${problem}. Check that every {tag} matches the ${docTypeRaw.toUpperCase()} schema (compare with templates/${docTypeRaw}.docx).`,
      },
      { status: 422 },
    );
  }

  await storage.saveClientFile(id, clientTemplateFilename(docTypeRaw), buffer);
  client.templates[docTypeRaw] = { filename: file.name, uploadedAt: new Date().toISOString() };
  await storage.saveClient(client);

  return NextResponse.json({ ok: true, client });
}
