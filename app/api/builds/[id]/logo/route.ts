import { NextRequest, NextResponse } from "next/server";
import { getStorage } from "@/lib/storage";

export const runtime = "nodejs";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const build = await getStorage().getBuild(id);
  if (!build?.materials.logo) return NextResponse.json({ error: "No logo" }, { status: 404 });

  const buffer = await getStorage().getBuildFile(build.id, build.materials.logo.filename);
  if (!buffer) return NextResponse.json({ error: "Logo file missing" }, { status: 404 });

  const name = build.materials.logo.filename.toLowerCase();
  const type = name.endsWith(".png") ? "image/png" : name.endsWith(".svg") ? "image/svg+xml" : "image/jpeg";
  return new NextResponse(new Uint8Array(buffer), { headers: { "Content-Type": type } });
}
