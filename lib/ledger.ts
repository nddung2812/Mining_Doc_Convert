import type { EngineId } from "./types";
import { getStorage } from "./storage";
import { apiSpendTodayUsd, buildApiSpendTodayUsd, dailyCapUsd } from "./cost";

/**
 * O(1) daily spend ledger. The cap check used to list every run and build ever
 * created (a blob fetch per record); now each UTC day keeps one small state
 * file that paid engines append to on completion. Reads/writes are not
 * transactional — concurrent completions could drop an entry — acceptable for
 * a single-operator tool where the cap is a guardrail, not billing.
 */

interface SpendDay {
  date: string;
  totalUsd: number;
  entries: number;
}

function todayKey(): string {
  // UTC day, matching the original cost.ts semantics.
  return new Date().toISOString().slice(0, 10);
}

function fileName(date: string): string {
  return `spend-${date}.json`;
}

/**
 * First touch of a new day seeds the ledger from full history, so upgrading
 * mid-day (or a lost append) can never under-count today's spend. After the
 * seed exists, everything is a single state-file read.
 */
async function loadOrSeedToday(): Promise<SpendDay> {
  const storage = getStorage();
  const date = todayKey();
  const buf = await storage.getStateFile(fileName(date));
  if (buf) {
    try {
      const day = JSON.parse(buf.toString("utf8")) as SpendDay;
      if (day.date === date && Number.isFinite(day.totalUsd)) return day;
    } catch {
      /* corrupt ledger file — reseed below */
    }
  }
  const legacy = apiSpendTodayUsd(await storage.listRuns()) + buildApiSpendTodayUsd(await storage.listBuilds());
  const seeded: SpendDay = { date, totalUsd: legacy, entries: 0 };
  await storage.saveStateFile(fileName(date), Buffer.from(JSON.stringify(seeded)));
  return seeded;
}

/** Record a paid model call. CLI runs are subscription-covered and skipped. */
export async function recordSpend(engine: EngineId, costUsd: number | null): Promise<void> {
  if (engine === "cli" || !costUsd || !(costUsd > 0)) return;
  try {
    const day = await loadOrSeedToday();
    day.totalUsd += costUsd;
    day.entries += 1;
    await getStorage().saveStateFile(fileName(day.date), Buffer.from(JSON.stringify(day)));
  } catch {
    // Ledger bookkeeping must never fail the request that spent the money.
  }
}

export interface CapStatus {
  spentUsd: number;
  capUsd: number;
  overCap: boolean;
}

export async function dailyCapStatus(): Promise<CapStatus> {
  const spentUsd = (await loadOrSeedToday()).totalUsd;
  const capUsd = dailyCapUsd();
  return { spentUsd, capUsd, overCap: spentUsd >= capUsd };
}

export function capReachedMessage(status: CapStatus): string {
  return `Daily API spend cap reached (US$${status.spentUsd.toFixed(2)} of US$${status.capUsd.toFixed(2)}). Try again tomorrow or raise DAILY_COST_CAP_USD.`;
}
