import { NextResponse } from "next/server";
import { getStorage } from "@/lib/storage";
import { rescueStaleRun } from "@/lib/runs";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = await getStorage().getRun(id);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  return NextResponse.json(await rescueStaleRun(run));
}
