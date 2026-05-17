import { prisma } from "./prisma";
import { localDateStr } from "./date";
import { settings } from "./state";

const PRUNE_INTERVAL_MS    = 24 * 3600_000;
const USAGE_RETENTION_DAYS = 30;

let pruneTimer: ReturnType<typeof setInterval> | null = null;

export async function pruneRequestLogs(): Promise<{ deleted: number; stripped: number; log_retention_days: number; msg_retention_days: number }> {
  const logDays = Math.max(1, parseInt(settings["log_retention_days"] || "30"));
  const msgDays = Math.max(1, parseInt(settings["msg_retention_days"] || "7"));
  const logCutoff = BigInt(Date.now() - logDays * 86400_000);
  const msgCutoff = BigInt(Date.now() - msgDays * 86400_000);
  const [deleted, stripped] = await Promise.all([
    prisma.request_logs.deleteMany({ where: { ts: { lt: logCutoff } } }),
    prisma.request_logs.updateMany({
      where: { ts: { lt: msgCutoff }, messages_json: { not: "" } },
      data: { messages_json: "" },
    }),
  ]);
  return { deleted: deleted.count, stripped: stripped.count, log_retention_days: logDays, msg_retention_days: msgDays };
}

export async function pruneDailyUsage(days = USAGE_RETENTION_DAYS): Promise<number> {
  const cutoff = localDateStr(new Date(Date.now() - days * 86400_000));
  const r = await prisma.daily_usage.deleteMany({ where: { date: { lt: cutoff } } });
  return r.count;
}

export async function pruneExpiredSessions(): Promise<number> {
  const r = await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return r.count;
}

async function runPruneCycle(): Promise<void> {
  try {
    const [logs, usage, sessions] = await Promise.all([
      pruneRequestLogs(),
      pruneDailyUsage(),
      pruneExpiredSessions(),
    ]);
    if (logs.deleted || logs.stripped || usage || sessions) {
      console.log(`[maintenance] request_logs deleted=${logs.deleted} msg_stripped=${logs.stripped} (retention ${logs.log_retention_days}d/${logs.msg_retention_days}d) · daily_usage=${usage} · expired_sessions=${sessions}`);
    }
  } catch (e: any) {
    console.warn("[maintenance] prune cycle failed:", e?.message ?? e);
  }
}

export function startMaintenanceScheduler(): void {
  if (pruneTimer) return;
  void runPruneCycle();
  pruneTimer = setInterval(() => { void runPruneCycle(); }, PRUNE_INTERVAL_MS);
  console.log(`[maintenance] scheduler started — every ${PRUNE_INTERVAL_MS / 3600_000}h`);
}

export function stopMaintenanceScheduler(): void {
  if (!pruneTimer) return;
  clearInterval(pruneTimer);
  pruneTimer = null;
  console.log("[maintenance] scheduler stopped");
}
