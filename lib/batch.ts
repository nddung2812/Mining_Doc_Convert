import Anthropic from "@anthropic-ai/sdk";
import type { DocType, RunRecord } from "./types";
import { getDocTypeAssets } from "./doctypes";
import { getStorage } from "./storage";
import { estimateCostUsd } from "./cost";
import { recordSpend } from "./ledger";
import { confidenceSummary } from "./runs";
import { ExtractionError, buildUserContent, parseJsonLoose, validateExtraction } from "./engine";

/**
 * Bulk extraction via the Anthropic Message Batches API: every request in a
 * batch is billed at 50% of standard token prices, with results typically
 * within the hour (guaranteed within 24h). The human reviewer is this app's
 * real throughput bottleneck anyway, so batch latency costs nothing on bulk
 * jobs. Anthropic-direct only — not the CLI, not the gateway.
 */
export const BATCH_DISCOUNT = 0.5;

export interface BatchEntry {
  runId: string;
  docType: DocType;
  clientName: string;
  sourceText: string;
}

/** Submit one batch covering every entry; returns the Anthropic batch id. */
export async function submitExtractionBatch(entries: BatchEntry[], apiKey: string, model: string): Promise<string> {
  const client = new Anthropic({ apiKey });
  const batch = await client.messages.batches.create({
    requests: entries.map((entry) => {
      const assets = getDocTypeAssets(entry.docType);
      return {
        custom_id: entry.runId,
        params: {
          model,
          max_tokens: 32000,
          thinking: { type: "adaptive" as const },
          system: assets.promptText,
          messages: [
            { role: "user" as const, content: buildUserContent(entry.docType, entry.clientName, entry.sourceText) },
          ],
          output_config: { format: { type: "json_schema" as const, schema: assets.schema } },
        },
      };
    }),
  });
  return batch.id;
}

type BatchResult = Anthropic.Messages.Batches.MessageBatchResult;

/** Apply one batch result to its run record; throws ExtractionError on failure. */
function applyBatchResult(run: RunRecord, result: BatchResult): void {
  if (result.type === "errored") {
    throw new ExtractionError(`Batch request failed: ${JSON.stringify(result.error).slice(0, 300)}`);
  }
  if (result.type === "expired") {
    throw new ExtractionError("The batch expired before this document was processed — start a new run.");
  }
  if (result.type === "canceled") {
    throw new ExtractionError("The batch was cancelled before this document was processed.");
  }

  const message = result.message;
  if (message.stop_reason === "refusal") {
    throw new ExtractionError("The model declined to process this content (safety refusal).");
  }
  if (message.stop_reason === "max_tokens") {
    throw new ExtractionError("Extraction was truncated (max_tokens). The source may be too large for one run.");
  }
  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") throw new ExtractionError("The model returned no text content.");

  const extracted = validateExtraction(run.docType, parseJsonLoose(textBlock.text));
  run.model = message.model;
  run.usage = {
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    cacheCreationInputTokens: message.usage.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: message.usage.cache_read_input_tokens ?? 0,
  };
  const full = estimateCostUsd({ engine: "api", model: message.model, usage: run.usage, reportedCostUsd: null });
  run.costUsd = full != null ? full * BATCH_DISCOUNT : null;
  run.extracted = extracted;
  run.validation = { valid: true, errors: [] };
  run.confidenceSummary = confidenceSummary(extracted);
  run.status = "awaiting_review";
}

/**
 * Poll-time settlement: if this run's batch has ended, write results into EVERY
 * run of the batch (one poll settles all siblings, so opening any run page —
 * or none, next time the batch is checked — completes the whole bulk job).
 * Returns the refreshed run; a still-processing batch returns it unchanged.
 */
export async function settleBatchRun(run: RunRecord, apiKey: string): Promise<RunRecord> {
  if (run.status !== "generating" || !run.batchId) return run;
  const storage = getStorage();
  const client = new Anthropic({ apiKey });

  let processingStatus: string;
  try {
    processingStatus = (await client.messages.batches.retrieve(run.batchId)).processing_status;
  } catch {
    return run; // transient retrieve error — keep polling
  }
  if (processingStatus !== "ended") return run;

  let refreshed = run;
  for await (const item of await client.messages.batches.results(run.batchId)) {
    const target = await storage.getRun(item.custom_id);
    if (!target || target.status !== "generating") continue; // already settled by a concurrent poll
    try {
      applyBatchResult(target, item.result);
      await recordSpend("api", target.costUsd);
    } catch (e) {
      const messageText = e instanceof Error ? e.message : "Batch extraction failed";
      target.status = "failed";
      target.error = messageText;
      target.validation = { valid: false, errors: e instanceof ExtractionError ? [messageText] : [] };
    }
    target.generationStartedAt = null;
    target.updatedAt = new Date().toISOString();
    await storage.saveRun(target);
    if (target.id === run.id) refreshed = target;
  }
  return refreshed;
}
