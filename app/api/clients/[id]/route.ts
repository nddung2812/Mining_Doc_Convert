import { NextRequest, NextResponse } from "next/server";
import { getStorage } from "@/lib/storage";

export const runtime = "nodejs";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const client = await getStorage().getClient(id);
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });
  return NextResponse.json(client);
}

/**
 * Delete a client: their record, templates, materials, studio content, and
 * every template build. Generated documents stay in History — they are the
 * audit trail and carry the client name as a snapshot.
 */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const storage = getStorage();
  const client = await storage.getClient(id);
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  const builds = (await storage.listBuilds()).filter((b) => b.clientId === id);
  if (builds.some((b) => b.status === "generating")) {
    return NextResponse.json(
      { error: "A template build is still running for this client — wait for it to finish before deleting." },
      { status: 409 },
    );
  }

  for (const build of builds) {
    await storage.deleteBuild(build.id);
  }
  await storage.deleteClient(id);
  return NextResponse.json({ ok: true, deleted: id, buildsDeleted: builds.length });
}
