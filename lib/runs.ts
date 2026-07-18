import type { ExtractionResult, RunRecord } from "./types";
import { getStorage } from "./storage";
import { NOT_FOUND_SENTINEL } from "./render";

/**
 * Longest an extraction can legitimately run (CLI engine timeout is 10 min);
 * past this, the background worker is dead (crash/restart), not slow.
 */
const STALE_GENERATING_MS = 15 * 60_000;

/**
 * Self-healing for runs whose background extraction died mid-flight: without
 * this they would sit in "generating" forever with no way to retry.
 */
export async function rescueStaleRun(run: RunRecord): Promise<RunRecord> {
  if (run.status !== "generating") return run;
  const lastBeat = Date.parse(run.updatedAt ?? run.generationStartedAt ?? run.createdAt);
  if (Number.isFinite(lastBeat) && Date.now() - lastBeat < STALE_GENERATING_MS) return run;

  run.status = "failed";
  run.error = "Extraction was interrupted (server stopped mid-run). Start a new run.";
  run.generationStartedAt = null;
  run.updatedAt = new Date().toISOString();
  await getStorage().saveRun(run);
  return run;
}

export async function listRunsRescued(): Promise<RunRecord[]> {
  const runs = await getStorage().listRuns();
  return Promise.all(runs.map((r) => rescueStaleRun(r)));
}

export function countNotFound(value: unknown): number {
  if (typeof value === "string") return value === NOT_FOUND_SENTINEL ? 1 : 0;
  if (Array.isArray(value)) return value.reduce((n: number, v) => n + countNotFound(v), 0);
  if (value && typeof value === "object") {
    return Object.values(value).reduce((n: number, v) => n + countNotFound(v), 0);
  }
  return 0;
}

export function confidenceSummary(extracted: ExtractionResult): RunRecord["confidenceSummary"] {
  const levels = extracted.meta.field_confidence;
  return {
    high: levels.filter((f) => f.level === "high").length,
    medium: levels.filter((f) => f.level === "medium").length,
    low: levels.filter((f) => f.level === "low").length,
    notFound: countNotFound(extracted.document),
    warnings: extracted.meta.warnings.length,
  };
}
