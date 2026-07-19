import { isDocType } from "@/lib/types";
import { reviseBlock, reviseBlocks } from "@/lib/revise";
import { ExtractionError, resolveEngine } from "@/lib/engine";
import { capReachedMessage, dailyCapStatus, recordSpend } from "@/lib/ledger";
import type { EditorBlock } from "@/lib/blocks";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_BLOCKS_PER_REVISE = 60;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; docType: string }> },
) {
  const { docType } = await params;
  if (!isDocType(docType)) return Response.json({ error: "Unknown document type" }, { status: 400 });

  const body = (await req.json().catch(() => null)) as {
    block?: EditorBlock;
    blocks?: EditorBlock[];
    instruction?: string;
  } | null;
  const multi = Array.isArray(body?.blocks);
  if (typeof body?.instruction !== "string" || !body.instruction.trim()) {
    return Response.json({ error: "Provide an instruction." }, { status: 400 });
  }
  if (multi) {
    const blocks = body.blocks!;
    if (blocks.length === 0 || blocks.length > MAX_BLOCKS_PER_REVISE || blocks.some((b) => !b?.type)) {
      return Response.json({ error: `Provide 1-${MAX_BLOCKS_PER_REVISE} valid blocks.` }, { status: 400 });
    }
  } else if (!body?.block?.type) {
    return Response.json({ error: "Provide a block and an instruction." }, { status: 400 });
  }

  const keys = {
    anthropicKey: req.headers.get("x-anthropic-key"),
    gatewayKey: req.headers.get("x-gateway-key"),
    model: req.headers.get("x-model"),
  };

  // Same daily-cap guardrail as runs and template builds.
  let paidEngine: boolean;
  try {
    paidEngine = resolveEngine(keys).engine !== "cli";
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Engine error" }, { status: 400 });
  }
  if (paidEngine) {
    const cap = await dailyCapStatus();
    if (cap.overCap) return Response.json({ error: capReachedMessage(cap) }, { status: 429 });
  }

  try {
    if (multi) {
      // One model call for the whole selection — the response carries only the
      // blocks that changed, which the editor applies by id.
      const revised = await reviseBlocks(body.blocks!, body.instruction.trim(), keys);
      await recordSpend(revised.engine, revised.costUsd);
      return Response.json({ blocks: revised.blocks, costUsd: revised.costUsd });
    }
    const revised = await reviseBlock(body.block!, body.instruction.trim(), keys);
    await recordSpend(revised.engine, revised.costUsd);
    return Response.json({ block: revised.block, costUsd: revised.costUsd });
  } catch (e) {
    const message = e instanceof ExtractionError || e instanceof Error ? e.message : "Revision failed";
    return Response.json({ error: message }, { status: 502 });
  }
}
