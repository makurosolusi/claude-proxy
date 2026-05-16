import { PgBoss as PgBossClass } from "pg-boss";
const PgBoss: any = PgBossClass;
import { config } from "../../config";
import { prisma } from "../../prisma";
import { distillStrategy } from "./mining";
import { insertOrMergeStrategy } from "./strategies";
import { logEvent } from "./lifecycle";
import { defaultConfig, type SecondBrainConfig } from "./config";
import { getConfig } from "../registry";
import { startPruneScheduler, stopPruneScheduler } from "./prune";

const QUEUE  = "sb-mine-strategy";
const SCHEMA = "sb_pgboss";

export interface MiningJobData {
  request_log_id: number;
  prompt:         string;
  response_text:  string;
  trajectory:     string;
  model:          string;
  user_id:        string;
  project:        string;
}

let boss: any | null = null;
let starting = false;

function mergedConfig(): SecondBrainConfig {
  const stored = getConfig("second-brain") || {};
  return { ...defaultConfig, ...(stored as Partial<SecondBrainConfig>) };
}

export async function startWorker(): Promise<void> {
  if (boss || starting) return;
  if (!config.databaseUrl) { console.warn("[second-brain.worker] DATABASE_URL empty — skipped"); return; }
  starting = true;
  try {
    boss = new PgBoss({ connectionString: config.databaseUrl, schema: SCHEMA });
    boss.on("error", (e: any) => console.error("[second-brain.worker] error:", e?.message ?? e));
    await boss.start();
    await boss.createQueue(QUEUE);
    await boss.work(QUEUE, { batchSize: 1, pollingIntervalSeconds: 5 }, async ([job]: any[]) => {
      try { await processMiningJob(job.data as MiningJobData); }
      catch (e: any) { console.error("[second-brain.worker] job", job.id, "failed:", e?.message ?? e); throw e; }
    });
    startPruneScheduler();
    console.log(`[second-brain.worker] started on queue ${QUEUE}`);
  } finally { starting = false; }
}

export async function stopWorker(): Promise<void> {
  stopPruneScheduler();
  if (!boss) return;
  try { await boss.stop({ graceful: true, timeout: 5000 }); }
  catch (e: any) { console.warn("[second-brain.worker] stop error:", e?.message ?? e); }
  boss = null;
  console.log("[second-brain.worker] stopped");
}

export async function enqueueMining(data: MiningJobData): Promise<string | null> {
  if (!boss) return null;
  const id = await boss.send(QUEUE, data);
  return id ?? null;
}

async function recentMiningCount(userId: string): Promise<number> {
  const hourAgo = BigInt(Date.now() - 3600_000);
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT COUNT(*)::int AS c FROM sb_extension_logs
      WHERE ts > $1 AND event_type IN ('mine_enqueued','mine_started') AND user_id = $2`,
    hourAgo, userId,
  );
  return rows[0]?.c || 0;
}

export async function canMineForUser(userId: string): Promise<boolean> {
  const cfg = mergedConfig();
  if (!cfg.miningEnabled) return false;
  const cnt = await recentMiningCount(userId);
  return cnt < cfg.miningThrottlePerHour;
}

async function alreadyMinedLog(logId: number): Promise<boolean> {
  if (!logId) return false;
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT 1 FROM sb_strategies WHERE source_log_id = $1 LIMIT 1`,
    logId,
  );
  return rows.length > 0;
}

async function processMiningJob(data: MiningJobData): Promise<void> {
  const cfg = mergedConfig();
  if (!cfg.miningEnabled) {
    await logEvent("mine_skipped", { reason: "mining disabled", log_id: data.request_log_id }, data.user_id).catch(() => {});
    return;
  }
  if (data.request_log_id && await alreadyMinedLog(data.request_log_id)) {
    await logEvent("mine_skipped", { reason: "already mined", log_id: data.request_log_id }, data.user_id).catch(() => {});
    return;
  }
  await logEvent("mine_started", { log_id: data.request_log_id, model: data.model }, data.user_id).catch(() => {});

  const traj = data.trajectory || data.prompt;
  if (!traj || traj.length < 100) {
    await logEvent("mine_skipped", { reason: "trajectory too short", log_id: data.request_log_id }, data.user_id).catch(() => {});
    return;
  }

  let result;
  try {
    result = await distillStrategy(traj, data.response_text, cfg.miningModel, cfg.miningProvider);
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    await logEvent("mine_failed", { reason: msg, log_id: data.request_log_id }, data.user_id).catch(() => {});
    // If the failure is "no provider available", don't bubble — pg-boss would
    // retry and create a hot loop. Log once and treat as a skip.
    if (msg.includes("mining skipped") || msg.includes("not available") || msg.includes("not configured")) {
      console.warn(`[second-brain.worker] mining skipped: ${msg}`);
      return;
    }
    throw e;
  }
  if (!result) {
    await logEvent("mine_failed", { reason: "parse failure", log_id: data.request_log_id }, data.user_id).catch(() => {});
    return;
  }
  if (result.skip) {
    await logEvent("mine_skipped", { reason: result.reason, log_id: data.request_log_id }, data.user_id).catch(() => {});
    return;
  }

  const scope = cfg.scope === "shared" ? "shared" : "user";
  const insertRes = await insertOrMergeStrategy(result, {
    scope, userId: data.user_id, project: data.project || "",
    sourceLogId: data.request_log_id || null,
  });
  await logEvent("mine_completed", {
    log_id: data.request_log_id,
    strategy_id: insertRes.id,
    merged: insertRes.merged,
    title: result.title,
  }, data.user_id).catch(() => {});
  console.log(`[second-brain.worker] ${insertRes.merged ? "MERGED" : "INSERT"} strategy ${insertRes.id}: "${result.title}"`);
}
