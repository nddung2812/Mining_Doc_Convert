import { NextRequest, NextResponse } from "next/server";
import { getStorage } from "@/lib/storage";
import { expectedRoundMs, rescueStaleBuild, reviewRoundsLeft, reviewRoundsUsed } from "@/lib/builds";
import { clientTemplateFilename } from "@/lib/clients";

export const runtime = "nodejs";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const stored = await getStorage().getBuild(id);
  if (!stored) return NextResponse.json({ error: "Build not found" }, { status: 404 });
  const build = await rescueStaleBuild(stored);
  return NextResponse.json({
    ...build,
    name: build.name || `${build.docType.toUpperCase()} template`,
    roundsUsed: reviewRoundsUsed(build),
    roundsLeft: reviewRoundsLeft(build),
    expectedDurationMs: expectedRoundMs(await getStorage().listBuilds(), build.model),
  });
}

/**
 * Delete a template build (record + materials + compiled template). If it was
 * the client's registered default, the newest remaining finalised template
 * takes over; with none left the client falls back to the master.
 */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const storage = getStorage();
  const build = await storage.getBuild(id);
  if (!build) return NextResponse.json({ error: "Build not found" }, { status: 404 });
  if (build.status === "generating") {
    return NextResponse.json(
      { error: "A design round is still running — wait for it to finish before deleting." },
      { status: 409 },
    );
  }

  const client = await storage.getClient(build.clientId);
  const slot = client?.templates[build.docType];
  if (client && slot && slot.filename === `built-${build.id.slice(0, 8)}.docx`) {
    const replacement = (await storage.listBuilds()).find(
      (b) => b.id !== build.id && b.clientId === client.id && b.docType === build.docType && b.status === "final" && b.final,
    );
    const buffer = replacement
      ? await storage.getBuildFile(replacement.id, replacement.final!.templateFilename)
      : null;
    if (replacement && buffer) {
      await storage.saveClientFile(client.id, clientTemplateFilename(build.docType), buffer);
      client.templates[build.docType] = {
        filename: `built-${replacement.id.slice(0, 8)}.docx`,
        uploadedAt: new Date().toISOString(),
      };
    } else {
      delete client.templates[build.docType];
    }
    await storage.saveClient(client);
  }

  await storage.deleteBuild(build.id);
  return NextResponse.json({ ok: true, deleted: build.id });
}

/** Rename a template. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const storage = getStorage();
  const build = await storage.getBuild(id);
  if (!build) return NextResponse.json({ error: "Build not found" }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as { name?: unknown };
  const name = String(body.name ?? "").trim().slice(0, 80);
  if (!name) return NextResponse.json({ error: "Template name is required" }, { status: 400 });

  build.name = name;
  await storage.saveBuild(build);
  return NextResponse.json({ id: build.id, name: build.name });
}
