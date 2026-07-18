import { NextRequest, NextResponse } from "next/server";
import { getStorage } from "@/lib/storage";
import { reviewRoundsLeft, reviewRoundsUsed } from "@/lib/builds";

export const runtime = "nodejs";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const build = await getStorage().getBuild(id);
  if (!build) return NextResponse.json({ error: "Build not found" }, { status: 404 });
  return NextResponse.json({
    ...build,
    roundsUsed: reviewRoundsUsed(build),
    roundsLeft: reviewRoundsLeft(build),
  });
}
