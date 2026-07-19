import { NextResponse } from "next/server";
import { getStorage } from "@/lib/storage";
import { rescueStaleRun } from "@/lib/runs";
import { settleBatchRun } from "@/lib/batch";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let run = await getStorage().getRun(id);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  // Batch runs settle at poll time: when the batch has ended, this fills in
  // results for every run in it. BYOK key arrives from the poller's header.
  if (run.status === "generating" && run.batchId) {
    const key = request.headers.get("x-anthropic-key") || process.env.ANTHROPIC_API_KEY;
    if (key) run = await settleBatchRun(run, key);
  }

  return NextResponse.json(await rescueStaleRun(run));
}
