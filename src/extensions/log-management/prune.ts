import { prisma } from "../../prisma";
import { defaultConfig, type LogManagementConfig } from "./config";
import { getConfig } from "../registry";

let pruneTimer: ReturnType<typeof setInterval> | null = null;

function mergedConfig(): LogManagementConfig {
  const stored = getConfig("log-management") || {};
  return { ...defaultConfig, ...(stored as Partial<LogManagementConfig>) };
}

export async function pruneOldLogs(): Promise<number> {
  const cfg = mergedConfig();
  const cutoff = BigInt(Date.now() - cfg.retentionDays * 86400_000);
  const r = await prisma.$executeRawUnsafe(`DELETE FROM app_logs WHERE ts < $1`, cutoff);
  return Number(r);
}

async function pruneCycle(): Promise<void> {
  try {
    const n = await pruneOldLogs();
    if (n > 0) console.log(`[log-management.prune] deleted ${n} entries older than retention`);
  } catch (e: any) {
    console.warn("[log-management.prune] cycle failed:", e?.message ?? e);
  }
}

export function startPruneScheduler(): void {
  if (pruneTimer) return;
  const cfg = mergedConfig();
  const intervalMs = Math.max(60 * 60_000, cfg.pruneIntervalHrs * 3600_000); // floor 1h
  void pruneCycle(); // run once at start
  pruneTimer = setInterval(() => { void pruneCycle(); }, intervalMs);
  console.log(`[log-management.prune] scheduler started — every ${intervalMs / 3600_000}h, retention ${cfg.retentionDays}d`);
}

export function stopPruneScheduler(): void {
  if (pruneTimer) {
    clearInterval(pruneTimer);
    pruneTimer = null;
    console.log("[log-management.prune] scheduler stopped");
  }
}
