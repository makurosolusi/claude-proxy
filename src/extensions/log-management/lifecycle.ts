import { prisma } from "../../prisma";
import { CREATE_TABLES_SQL } from "./schema";
import { startLogSink, stopLogSink, drainQueue } from "./sink";
import { startPruneScheduler, stopPruneScheduler } from "./prune";
import type { EnableResult } from "../types";

export async function onEnable(): Promise<EnableResult> {
  for (const stmt of CREATE_TABLES_SQL) {
    try { await prisma.$executeRawUnsafe(stmt); }
    catch (e: any) {
      return { ok: false, error: `Schema setup failed: ${e?.message ?? e}` };
    }
  }

  // Verify table exists before wiring sinks (otherwise sink writes would 500 in a loop).
  const check = await prisma.$queryRawUnsafe<{ exists: string | null }[]>(
    "SELECT to_regclass('public.app_logs')::text AS exists"
  );
  if (!check?.[0]?.exists) {
    return { ok: false, error: "Verification failed: app_logs table not present after creation" };
  }

  startLogSink();
  startPruneScheduler();
  console.log("[log-management] enabled: app_logs table ready, sink + prune active");
  return { ok: true };
}

export async function onDisable(): Promise<void> {
  stopPruneScheduler();
  stopLogSink();
  // Best-effort drain on disable so the last few buffered lines aren't lost.
  try { await drainQueue(); } catch {}
  console.log("[log-management] disabled — sink + prune stopped, data preserved");
}
