import { prisma } from "../../prisma";
import { addLogSink, type LogLine } from "../../consoleBuffer";
import { defaultConfig, type LogManagementConfig } from "./config";
import { getConfig } from "../registry";

// In-memory queue — flushed to DB in batches on a timer. Avoids one INSERT per
// log line (would be devastating under load).
const queue: LogLine[] = [];
const QUEUE_HARD_CAP = 5000;
let unsubscribe: (() => void) | null = null;
let flushTimer: ReturnType<typeof setInterval> | null = null;
let flushing = false;

function mergedConfig(): LogManagementConfig {
  const stored = getConfig("log-management") || {};
  return { ...defaultConfig, ...(stored as Partial<LogManagementConfig>) };
}

// Best-effort detection of source from message content. Looking for patterns
// like "[upstream]", "[proxy]", "[second-brain]" at the start. Falls back to
// "console" so the source column is always populated.
function detectSource(msg: string): string {
  const m = msg.match(/^\[([a-z][a-z0-9.-]{0,30})\]/i);
  return m ? m[1]!.toLowerCase() : "console";
}

export function startLogSink(): void {
  if (unsubscribe) return; // idempotent

  const cfg = mergedConfig();
  const levelSet = new Set(cfg.captureLevels);

  unsubscribe = addLogSink((line: LogLine) => {
    if (!levelSet.has(line.level)) return;
    if (queue.length >= QUEUE_HARD_CAP) queue.shift(); // drop oldest to bound memory
    queue.push(line);
  });

  flushTimer = setInterval(() => { void flush(); }, cfg.flushIntervalMs);
}

export function stopLogSink(): void {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  if (flushTimer)  { clearInterval(flushTimer); flushTimer = null; }
  // Final flush so anything buffered isn't lost.
  void flush();
}

async function flush(): Promise<void> {
  if (flushing || queue.length === 0) return;
  flushing = true;
  try {
    const cfg = mergedConfig();
    const batch = queue.splice(0, cfg.flushMaxBatch);
    if (batch.length === 0) return;

    // Build a single multi-row INSERT — Postgres handles thousands per round-trip
    // efficiently this way. Using $queryRawUnsafe with positional params.
    const values: string[] = [];
    const params: any[] = [];
    let i = 1;
    for (const line of batch) {
      const source = detectSource(line.msg);
      values.push(`($${i++}, $${i++}, $${i++}, $${i++}, NULL)`);
      params.push(BigInt(line.ts), line.level, source, line.msg.slice(0, 8000));
    }
    const sql = `INSERT INTO app_logs (ts, level, source, message, context) VALUES ${values.join(",")}`;
    await prisma.$executeRawUnsafe(sql, ...params);
  } catch (e: any) {
    // Don't re-queue: if DB is broken, persistent retry would spam. Just log
    // via the original console (which bypasses our sink — won't recurse).
    console.warn("[log-management] flush failed:", e?.message ?? e);
  } finally {
    flushing = false;
  }
}

// Exposed for shutdown — caller can `await` final drain.
export async function drainQueue(): Promise<void> {
  await flush();
}
