import { NextRequest, NextResponse } from "next/server";
import { getStorage } from "@/lib/storage";
import { clientTemplateFilename } from "@/lib/clients";
import { validateTemplate } from "@/lib/template-check";
import { compileTemplate } from "@/lib/template-compile";
import { FINAL_TEMPLATE_FILENAME, latestSpec, loadLogo } from "@/lib/builds";

export const runtime = "nodejs";

/**
 * Build the final template from the approved iteration, dry-run validate it,
 * and register it as this client's template for the doc type — every future
 * run for the client renders with it.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const storage = getStorage();
  const build = await storage.getBuild(id);
  if (!build) return NextResponse.json({ error: "Build not found" }, { status: 404 });
  if (build.status === "final") return NextResponse.json({ id: build.id, status: "final" });
  if (build.status !== "review") {
    return NextResponse.json({ error: `Build is ${build.status} — nothing to finalize.` }, { status: 409 });
  }

  const spec = latestSpec(build);
  if (!spec) return NextResponse.json({ error: "No template iteration to finalize" }, { status: 409 });

  const buffer = await compileTemplate(build.docType, spec, await loadLogo(build));

  // The compiler emits the master {tags} verbatim, so this must pass; if it
  // ever fails, surface it loudly rather than registering a broken template.
  const problem = validateTemplate(build.docType, buffer);
  if (problem) {
    return NextResponse.json(
      { error: `Compiled template failed validation (${problem}) — this is a bug, please report it.` },
      { status: 500 },
    );
  }

  await storage.saveBuildFile(build.id, FINAL_TEMPLATE_FILENAME, buffer);

  const client = await storage.getClient(build.clientId);
  if (client) {
    await storage.saveClientFile(client.id, clientTemplateFilename(build.docType), buffer);
    client.templates[build.docType] = {
      filename: `built-${build.id.slice(0, 8)}.docx`,
      uploadedAt: new Date().toISOString(),
    };
    await storage.saveClient(client);
  }

  build.status = "final";
  build.final = { finalizedAt: new Date().toISOString(), templateFilename: FINAL_TEMPLATE_FILENAME };
  await storage.saveBuild(build);

  return NextResponse.json({ id: build.id, status: "final", registered: Boolean(client) });
}
