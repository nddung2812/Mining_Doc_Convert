import type { RunRecord } from "./types";
import type { EngineOutput } from "./engine";

// USD per million tokens. Keyed by model-id prefix; first match wins.
const PRICING: { prefix: string; input: number; output: number; cacheWrite: number; cacheRead: number }[] = [
  { prefix: "claude-fable-5", input: 10, output: 50, cacheWrite: 12.5, cacheRead: 1 },
  { prefix: "claude-opus", input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  { prefix: "claude-sonnet", input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  { prefix: "claude-haiku", input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
];

export function estimateCostUsd(output: EngineOutput): number | null {
  if (output.engine === "cli") return output.reportedCostUsd; // informational; covered by subscription
  if (output.engine === "gateway") return output.reportedCostUsd; // computed from the gateway's live pricing catalog
  if (!output.usage) return null;
  const p = PRICING.find((row) => output.model.startsWith(row.prefix)) ?? PRICING[1];
  const { inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens } = output.usage;
  return (
    (inputTokens * p.input +
      outputTokens * p.output +
      cacheCreationInputTokens * p.cacheWrite +
      cacheReadInputTokens * p.cacheRead) /
    1_000_000
  );
}

export function dailyCapUsd(): number {
  const raw = Number(process.env.DAILY_COST_CAP_USD);
  return Number.isFinite(raw) && raw > 0 ? raw : 10;
}

/** API + gateway spend today (UTC). CLI runs are subscription-covered and excluded. */
export function apiSpendTodayUsd(runs: RunRecord[]): number {
  const today = new Date().toISOString().slice(0, 10);
  return runs
    .filter((r) => (r.engine === "api" || r.engine === "gateway") && r.createdAt.slice(0, 10) === today)
    .reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
}
