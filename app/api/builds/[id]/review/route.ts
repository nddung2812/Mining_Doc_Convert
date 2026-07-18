import { NextRequest, NextResponse, after } from "next/server";
import { MAX_REVIEW_ROUNDS } from "@/lib/types";
import { getStorage } from "@/lib/storage";
import { resolveEngine } from "@/lib/engine";
import { runTemplateDesign } from "@/lib/template-engine";
import { designInputFromBuild, latestSpec, parseFeedback, reviewRoundsUsed } from "@/lib/builds";
import { estimateCostUsd } from "@/lib/cost";
import { capReachedMessage, dailyCapStatus, recordSpend } from "@/lib/ledger";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Submit a review round: per-section comments in, a revised template out.
 * Hard-capped at MAX_REVIEW_ROUNDS submissions per build.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const storage = getStorage();
  const build = await storage.getBuild(id);
  if (!build) return NextResponse.json({ error: "Build not found" }, { status: 404 });
  if (build.status !== "review") {
    return NextResponse.json({ error: `Build is ${build.status} — reviews are closed.` }, { status: 409 });
  }

  const used = reviewRoundsUsed(build);
  if (used >= MAX_REVIEW_ROUNDS) {
    return NextResponse.json(
      { error: `All ${MAX_REVIEW_ROUNDS} review rounds are used — build the final template.` },
      { status: 409 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as { comments?: unknown };
  const feedback = parseFeedback(build.docType, body.comments);
  if (!feedback) {
    return NextResponse.json(
      { error: "Add at least one section comment — or, if it already looks right, build the final instead." },
      { status: 400 },
    );
  }

  let choice;
  try {
    choice = resolveEngine({
      anthropicKey: request.headers.get("x-anthropic-key"),
      gatewayKey: request.headers.get("x-gateway-key"),
      model: build.model,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Engine error" }, { status: 400 });
  }
  if (choice.engine !== "cli") {
    const cap = await dailyCapStatus();
    if (cap.overCap) return NextResponse.json({ error: capReachedMessage(cap) }, { status: 429 });
  }

  const previousSpec = latestSpec(build)!;
  const reviewed = build.iterations[build.iterations.length - 1];
  reviewed.feedback = feedback;
  reviewed.reviewedAt = new Date().toISOString();
  build.status = "generating";
  build.error = null;
  build.generationStartedAt = reviewed.reviewedAt;
  build.updatedAt = reviewed.reviewedAt;
  await storage.saveBuild(build);

  // The revision runs after the response; the wizard (or workspace) polls.
  after(async () => {
    const started = Date.now();
    try {
      const output = await runTemplateDesign(await designInputFromBuild(build, { previousSpec, feedback }), choice);
      const costUsd = estimateCostUsd(output);
      await recordSpend(output.engine, costUsd);
      build.iterations.push({
        version: reviewed.version + 1,
        createdAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        spec: output.spec,
        engine: output.engine,
        model: output.model,
        usage: output.usage,
        costUsd,
        feedback: null,
        reviewedAt: null,
      });
    } catch (e) {
      // The round failed but the build survives — the previous iteration stands.
      build.error = `Revision failed: ${e instanceof Error ? e.message : "unknown error"}. Your last version is untouched — submit the review again.`;
    }
    build.status = "review";
    build.generationStartedAt = null;
    build.updatedAt = new Date().toISOString();
    await storage.saveBuild(build);
  });

  return NextResponse.json({
    id: build.id,
    status: "generating",
    roundsLeft: MAX_REVIEW_ROUNDS - used - 1,
  });
}
