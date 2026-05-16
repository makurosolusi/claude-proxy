import { prisma } from "../../prisma";
import { logEvent } from "./lifecycle";

const PRUNE_INTERVAL_MS = 24 * 3600_000;
const STRATEGY_MIN_AGE_MS = 24 * 3600_000;
const STRATEGY_MIN_ATTEMPTS = 5;
const STRATEGY_FAIL_RATIO_THRESHOLD = 0.7;

let pruneTimer: ReturnType<typeof setInterval> | null = null;

export async function pruneExpiredCache(): Promise<number> {
  const now = BigInt(Date.now());
  const r = await prisma.$executeRawUnsafe(
    `DELETE FROM sb_prompt_cache WHERE expires_at <= $1`,
    now,
  );
  return Number(r);
}

export async function pruneLowQualityStrategies(): Promise<number> {
  const cutoff = BigInt(Date.now() - STRATEGY_MIN_AGE_MS);
  const r = await prisma.$executeRawUnsafe(
    `DELETE FROM sb_strategies
      WHERE created_at < $1
        AND (success_count + fail_count) >= $2
        AND fail_count::float / (success_count + fail_count + 1)::float >= $3`,
    cutoff, STRATEGY_MIN_ATTEMPTS, STRATEGY_FAIL_RATIO_THRESHOLD,
  );
  return Number(r);
}

export async function pruneOldLogs(daysToKeep = 30): Promise<number> {
  const cutoff = BigInt(Date.now() - daysToKeep * 86400_000);
  const r = await prisma.$executeRawUnsafe(
    `DELETE FROM sb_extension_logs WHERE ts < $1`,
    cutoff,
  );
  return Number(r);
}

async function runPruneCycle(): Promise<void> {
  try {
    const [cache, strategies, logs] = await Promise.all([
      pruneExpiredCache(),
      pruneLowQualityStrategies(),
      pruneOldLogs(30),
    ]);
    if (cache || strategies || logs) {
      console.log(`[second-brain.prune] cache=${cache} low_quality_strategies=${strategies} old_logs=${logs}`);
      await logEvent("prune_completed", { cache, strategies, logs }).catch(() => {});
    }
  } catch (e: any) {
    console.warn("[second-brain.prune] cycle failed:", e?.message ?? e);
  }
}

export function startPruneScheduler(): void {
  if (pruneTimer) return;
  void runPruneCycle();
  pruneTimer = setInterval(runPruneCycle, PRUNE_INTERVAL_MS);
  console.log(`[second-brain.prune] scheduler started — every ${PRUNE_INTERVAL_MS / 3600_000}h`);
}

export function stopPruneScheduler(): void {
  if (pruneTimer) {
    clearInterval(pruneTimer);
    pruneTimer = null;
    console.log("[second-brain.prune] scheduler stopped");
  }
}
