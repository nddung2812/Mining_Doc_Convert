import { NextRequest, NextResponse } from "next/server";
import { getStorage } from "@/lib/storage";
import { expectedRoundMs, rescueStaleBuild, reviewRoundsLeft, reviewRoundsUsed } from "@/lib/builds";

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
