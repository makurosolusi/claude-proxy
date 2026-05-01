import { Database } from "bun:sqlite";
import fs from "fs";
import path from "path";
import { config } from "./config";
import type { TokenEntry, UpstreamState, DailyUsage, RequestLogEntry } from "./types";

// ── DB Init ──────────────────────────────────────────────────────────────────
const dir = path.dirname(config.dbFile);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

function openDb(): InstanceType<typeof Database> {
  try {
    const d = new Database(config.dbFile, { create: true });
    d.exec("PRAGMA journal_mode = WAL");
    d.exec("PRAGMA synchronous = NORMAL");
    return d;
  } catch (e) {
    // Corrupted DB (e.g. incompatible WAL after file replace) — delete WAL/SHM and retry once
    console.error("[db] Open failed, attempting WAL recovery:", (e as any).message);
    for (const suffix of ["-wal", "-shm"]) {
      try { fs.unlinkSync(config.dbFile + suffix); } catch {}
    }
    try {
      const d = new Database(config.dbFile, { create: true });
      d.exec("PRAGMA journal_mode = WAL");
      d.exec("PRAGMA synchronous = NORMAL");
      console.log("[db] WAL recovery successful");
      return d;
    } catch (e2) {
      // Truly unrecoverable — delete DB and start fresh
      console.error("[db] Recovery failed, starting fresh:", (e2 as any).message);
      for (const suffix of ["", "-wal", "-shm"]) {
        try { fs.unlinkSync(config.dbFile + suffix); } catch {}
      }
      const d = new Database(config.dbFile, { create: true });
      d.exec("PRAGMA journal_mode = WAL");
      d.exec("PRAGMA synchronous = NORMAL");
      return d;
    }
  }
}

export const db = openDb();

db.exec(`
  CREATE TABLE IF NOT EXISTS tokens (
    key          TEXT    PRIMARY KEY,
    lim          REAL,
    win          INTEGER NOT NULL,
    used         INTEGER NOT NULL DEFAULT 0,
    window_start INTEGER NOT NULL,
    paused       INTEGER NOT NULL DEFAULT 0,
    dynamic      INTEGER NOT NULL DEFAULT 0,
    deleted      INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS upstream_state (
    id                   INTEGER PRIMARY KEY DEFAULT 1,
    last_known_resets_at TEXT,
    detected_window_ms   INTEGER,
    last_poll            INTEGER,
    five_hour_util       REAL,
    five_hour_resets_at  TEXT,
    seven_day_util       REAL,
    seven_day_resets_at  TEXT,
    sonnet_util          REAL,
    sonnet_resets_at     TEXT,
    opus_util            REAL,
    opus_resets_at       TEXT
  );
  CREATE TABLE IF NOT EXISTS daily_usage (
    date       TEXT    NOT NULL,
    token_key  TEXT    NOT NULL,
    used       INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (date, token_key)
  );
  CREATE TABLE IF NOT EXISTS request_logs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    ts              INTEGER NOT NULL,
    token_key       TEXT    NOT NULL,
    model           TEXT    NOT NULL DEFAULT '',
    input_tokens    INTEGER NOT NULL DEFAULT 0,
    output_tokens   INTEGER NOT NULL DEFAULT 0,
    cache_read      INTEGER NOT NULL DEFAULT 0,
    cache_creation  INTEGER NOT NULL DEFAULT 0,
    stream          INTEGER NOT NULL DEFAULT 0,
    status          INTEGER NOT NULL DEFAULT 200,
    stop_reason     TEXT    DEFAULT '',
    tool_use_count  INTEGER NOT NULL DEFAULT 0,
    duration_ms     INTEGER NOT NULL DEFAULT 0,
    turns           INTEGER NOT NULL DEFAULT 0,
    prompt          TEXT    DEFAULT '',
    system_prompt   TEXT    DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_rl_ts  ON request_logs(ts DESC);
  CREATE INDEX IF NOT EXISTS idx_rl_key ON request_logs(token_key, ts DESC);
  CREATE TABLE IF NOT EXISTS admin_sessions (
    token      TEXT    PRIMARY KEY,
    created_at INTEGER NOT NULL,
    last_used  INTEGER NOT NULL
  );
`);

// Migration: add columns to existing DBs
try { db.exec("ALTER TABLE request_logs ADD COLUMN system_prompt TEXT DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE request_logs ADD COLUMN cache_read INTEGER NOT NULL DEFAULT 0"); } catch {}
try { db.exec("ALTER TABLE request_logs ADD COLUMN cache_creation INTEGER NOT NULL DEFAULT 0"); } catch {}
try { db.exec("ALTER TABLE request_logs ADD COLUMN stop_reason TEXT DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE request_logs ADD COLUMN tool_use_count INTEGER NOT NULL DEFAULT 0"); } catch {}
try { db.exec("ALTER TABLE request_logs ADD COLUMN duration_ms INTEGER NOT NULL DEFAULT 0"); } catch {}
try { db.exec("ALTER TABLE request_logs ADD COLUMN turns INTEGER NOT NULL DEFAULT 0"); } catch {}
try { db.exec("ALTER TABLE tokens ADD COLUMN mode TEXT NOT NULL DEFAULT 'inherit'"); } catch {} // kept for DB compat

// ── Prepared statements ───────────────────────────────────────────────────────
const stmts = {
  insertIgnore: db.prepare(`
    INSERT OR IGNORE INTO tokens (key, lim, win, used, window_start, paused, dynamic)
    VALUES ($key, $lim, $win, $used, $window_start, $paused, $dynamic)
  `),
  insertReplace: db.prepare(`
    INSERT OR REPLACE INTO tokens (key, lim, win, used, window_start, paused, dynamic, deleted)
    VALUES ($key, $lim, $win, $used, $window_start, $paused, $dynamic, 0)
  `),
  updateUsage: db.prepare(`UPDATE tokens SET used=$used WHERE key=$key`),
  updateToken: db.prepare(`UPDATE tokens SET lim=$lim, win=$win, paused=$paused WHERE key=$key`),
  softDelete:  db.prepare(`UPDATE tokens SET deleted=1 WHERE key=$key`),
  resetOne:    db.prepare(`UPDATE tokens SET used=0, window_start=$ws WHERE key=$key`),
  resetAll:    db.prepare(`UPDATE tokens SET used=0, win=$win, window_start=$ws WHERE deleted=0`),
  alignAll:    db.prepare(`UPDATE tokens SET win=$win, window_start=$ws WHERE deleted=0`),
  upsertDaily: db.prepare(`
    INSERT INTO daily_usage (date, token_key, used) VALUES ($date, $key, $delta)
    ON CONFLICT(date, token_key) DO UPDATE SET used = used + excluded.used
  `),
  pruneDaily:  db.prepare(`DELETE FROM daily_usage WHERE date < $cutoff`),
  insertLog:   db.prepare(`
    INSERT INTO request_logs (ts, token_key, model, input_tokens, output_tokens, cache_read, cache_creation,
      stream, status, stop_reason, tool_use_count, duration_ms, turns, prompt, system_prompt)
    VALUES ($ts, $key, $model, $inp, $out, $cr, $cc, $stream, $status, $sr, $tuc, $dur, $turns, $prompt, $sys)
  `),
  pruneLog:    db.prepare(`DELETE FROM request_logs WHERE ts < $cutoff`),
  insertSession: db.prepare(`INSERT OR REPLACE INTO admin_sessions (token, created_at, last_used) VALUES ($token, $now, $now)`),
  touchSession:  db.prepare(`UPDATE admin_sessions SET last_used=$now WHERE token=$token`),
  checkSession:  db.prepare(`SELECT 1 FROM admin_sessions WHERE token=$token`),
  deleteSession: db.prepare(`DELETE FROM admin_sessions WHERE token=$token`),
  pruneSessions: db.prepare(`DELETE FROM admin_sessions WHERE last_used < $cutoff`),
  upsertUp:    db.prepare(`
    INSERT OR REPLACE INTO upstream_state (
      id, last_known_resets_at, detected_window_ms, last_poll,
      five_hour_util, five_hour_resets_at,
      seven_day_util, seven_day_resets_at,
      sonnet_util, sonnet_resets_at,
      opus_util, opus_resets_at
    ) VALUES (
      1, $lkra, $dwms, $lp,
      $fhu, $fhra,
      $sdu, $sdra,
      $snu, $snra,
      $opu, $opra
    )
  `),
};

// ── Runtime state ─────────────────────────────────────────────────────────────
export const tokens: Record<string, TokenEntry> = {};
export const dailyUsage: DailyUsage = {};
export const recentLogs: RequestLogEntry[] = [];
export let totalTokensAllTime = 0;

export const upstream: UpstreamState = {
  fiveHour: null, sevenDay: null, sevenDaySonnet: null, sevenDayOpus: null,
  lastPoll: 0, lastPollOk: false, lastError: null,
  lastKnownResetsAt: null, detectedWindowMs: null, pollBackoffUntil: 0,
  tokenCache: { value: null, readAt: 0, email: null },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function toLim(limit: number): number | null {
  return limit === Infinity ? null : limit;
}
function fromLim(lim: number | null): number {
  return lim === null ? Infinity : lim;
}

// ── DB write functions ────────────────────────────────────────────────────────
export function dbInsertEnvToken(key: string, entry: TokenEntry) {
  stmts.insertIgnore.run({
    $key: key, $lim: toLim(entry.limit), $win: entry.window,
    $used: entry.used, $window_start: entry.windowStart,
    $paused: entry.paused ? 1 : 0, $dynamic: 0,
  });
}

export function dbInsertToken(key: string, entry: TokenEntry) {
  stmts.insertReplace.run({
    $key: key, $lim: toLim(entry.limit), $win: entry.window,
    $used: entry.used, $window_start: entry.windowStart,
    $paused: entry.paused ? 1 : 0, $dynamic: entry.dynamic ? 1 : 0,
  });
}

export function dbUpdateUsage(key: string, used: number) {
  stmts.updateUsage.run({ $used: used, $key: key });
}

export function dbUpdateToken(key: string, entry: TokenEntry) {
  stmts.updateToken.run({ $lim: toLim(entry.limit), $win: entry.window, $paused: entry.paused ? 1 : 0, $key: key });
}

export function dbSoftDelete(key: string) {
  stmts.softDelete.run({ $key: key });
}

export function dbResetToken(key: string, windowStart: number) {
  stmts.resetOne.run({ $ws: windowStart, $key: key });
}

export function dbResetAllTokens(win: number, windowStart: number) {
  stmts.resetAll.run({ $win: win, $ws: windowStart });
}

export function dbAlignAllTokens(win: number, windowStart: number) {
  stmts.alignAll.run({ $win: win, $ws: windowStart });
}

export function dbUpsertDailyUsage(date: string, key: string, delta: number) {
  stmts.upsertDaily.run({ $date: date, $key: key, $delta: delta });
}

export function dbSaveUpstream() {
  stmts.upsertUp.run({
    $lkra: upstream.lastKnownResetsAt,
    $dwms: upstream.detectedWindowMs,
    $lp:   upstream.lastPoll || null,
    $fhu:  upstream.fiveHour?.utilization   ?? null,
    $fhra: upstream.fiveHour?.resets_at     ?? null,
    $sdu:  upstream.sevenDay?.utilization   ?? null,
    $sdra: upstream.sevenDay?.resets_at     ?? null,
    $snu:  upstream.sevenDaySonnet?.utilization ?? null,
    $snra: upstream.sevenDaySonnet?.resets_at   ?? null,
    $opu:  upstream.sevenDayOpus?.utilization   ?? null,
    $opra: upstream.sevenDayOpus?.resets_at     ?? null,
  });
}

export function dbLogRequest(entry: Omit<RequestLogEntry, "id">) {
  const result = stmts.insertLog.run({
    $ts: entry.ts, $key: entry.token_key, $model: entry.model,
    $inp: entry.input_tokens, $out: entry.output_tokens,
    $cr: entry.cache_read || 0, $cc: entry.cache_creation || 0,
    $stream: entry.stream ? 1 : 0, $status: entry.status,
    $sr: entry.stop_reason || "", $tuc: entry.tool_use_count || 0,
    $dur: entry.duration_ms || 0, $turns: entry.turns || 0,
    $prompt: entry.prompt, $sys: entry.system_prompt || "",
  });
  totalTokensAllTime += entry.input_tokens + entry.output_tokens + (entry.cache_read || 0) + (entry.cache_creation || 0);
  const full: RequestLogEntry = { id: Number(result.lastInsertRowid), ...entry };
  recentLogs.unshift(full);
  if (recentLogs.length > 200) recentLogs.pop();
}

const SESSION_TTL = 30 * 86400 * 1000; // 30 days

export function dbCreateSession(token: string) {
  stmts.insertSession.run({ $token: token, $now: Date.now() });
  // prune expired sessions opportunistically
  stmts.pruneSessions.run({ $cutoff: Date.now() - SESSION_TTL });
}

export function dbCheckSession(token: string): boolean {
  const row = stmts.checkSession.get({ $token: token });
  if (!row) return false;
  stmts.touchSession.run({ $token: token, $now: Date.now() });
  return true;
}

export function dbDeleteSession(token: string) {
  stmts.deleteSession.run({ $token: token });
}

function rowToLog(r: any): RequestLogEntry {
  return {
    id: r.id || 0, ts: r.ts || 0, token_key: r.token_key || "", model: r.model || "",
    input_tokens: r.input_tokens || 0, output_tokens: r.output_tokens || 0,
    cache_read: r.cache_read || 0, cache_creation: r.cache_creation || 0,
    stream: r.stream === 1, status: r.status || 200,
    stop_reason: r.stop_reason || "", tool_use_count: r.tool_use_count || 0,
    duration_ms: r.duration_ms || 0, turns: r.turns || 0,
    prompt: r.prompt || "", system_prompt: r.system_prompt || "",
  };
}

export function dbQueryLogs(page: number, limit: number, user: string): RequestLogEntry[] {
  try {
    const offset = (page - 1) * limit;
    const rows = user
      ? db.query("SELECT * FROM request_logs WHERE token_key=? ORDER BY ts DESC LIMIT ? OFFSET ?")
          .all(user, limit, offset) as any[]
      : db.query("SELECT * FROM request_logs ORDER BY ts DESC LIMIT ? OFFSET ?")
          .all(limit, offset) as any[];
    return rows.map(rowToLog);
  } catch { return []; }
}

export function dbCountLogs(user: string): number {
  try {
    const row = user
      ? db.query("SELECT COUNT(*) as n FROM request_logs WHERE token_key=?").get(user) as any
      : db.query("SELECT COUNT(*) as n FROM request_logs").get() as any;
    return row?.n || 0;
  } catch { return 0; }
}

export function dbGetLog(id: number): RequestLogEntry | null {
  try {
    const row = db.query("SELECT * FROM request_logs WHERE id=?").get(id) as any;
    return row ? rowToLog(row) : null;
  } catch { return null; }
}

export function dbClearLogs(user?: string) {
  if (user) {
    db.query("DELETE FROM request_logs WHERE token_key=?").run(user);
    const idx = recentLogs.findIndex(l => l.token_key === user);
    while (true) { const i = recentLogs.findIndex(l => l.token_key === user); if (i < 0) break; recentLogs.splice(i, 1); }
  } else {
    db.query("DELETE FROM request_logs").run();
    recentLogs.splice(0, recentLogs.length);
  }
}

export function dbGetTokenKeys(): string[] {
  try {
    return (db.query("SELECT DISTINCT token_key FROM request_logs ORDER BY token_key").all() as any[])
      .map(r => r.token_key).filter(Boolean);
  } catch { return []; }
}

// ── Load from DB ──────────────────────────────────────────────────────────────
export function loadFromDb() {
  const now = Date.now();

  const rows = db.query("SELECT * FROM tokens WHERE deleted=0").all() as any[];
  for (const row of rows) {
    const expired = now - row.window_start >= row.win;
    tokens[row.key] = {
      limit:       fromLim(row.lim),
      window:      row.win,
      used:        expired ? 0 : row.used,
      windowStart: expired ? now : row.window_start,
      paused:      row.paused === 1,
      dynamic:     row.dynamic === 1,
      mode:        (row.mode as "inherit" | "direct" | "cliproxy") || "inherit",
    };
    if (expired) stmts.resetOne.run({ $ws: now, $key: row.key });
  }

  const up = db.query("SELECT * FROM upstream_state WHERE id=1").get() as any;
  if (up) {
    if (up.last_known_resets_at) upstream.lastKnownResetsAt = up.last_known_resets_at;
    if (up.detected_window_ms)   upstream.detectedWindowMs  = up.detected_window_ms;
    if (up.last_poll)            upstream.lastPoll           = up.last_poll;
    if (up.five_hour_util  != null) upstream.fiveHour       = { utilization: up.five_hour_util,  resets_at: up.five_hour_resets_at };
    if (up.seven_day_util  != null) upstream.sevenDay       = { utilization: up.seven_day_util,  resets_at: up.seven_day_resets_at };
    if (up.sonnet_util     != null) upstream.sevenDaySonnet = { utilization: up.sonnet_util,     resets_at: up.sonnet_resets_at };
    if (up.opus_util       != null) upstream.sevenDayOpus   = { utilization: up.opus_util,       resets_at: up.opus_resets_at };
    if (up.detected_window_ms) {
      for (const tk of Object.values(tokens)) tk.window = up.detected_window_ms;
    }
  }

  const cutoff = new Date(now - 30 * 86400000).toISOString().slice(0, 10);
  stmts.pruneDaily.run({ $cutoff: cutoff });
  const usageRows = db.query(
    "SELECT date, token_key, used FROM daily_usage WHERE date >= $cutoff"
  ).all({ $cutoff: cutoff }) as any[];
  for (const row of usageRows) {
    if (!dailyUsage[row.date]) dailyUsage[row.date] = {};
    dailyUsage[row.date][row.token_key] = row.used;
  }

  // Prune + load recent request logs
  const logCutoff = now - 30 * 86400000;
  stmts.pruneLog.run({ $cutoff: logCutoff });
  const logRows = db.query(
    "SELECT * FROM request_logs ORDER BY ts DESC LIMIT 200"
  ).all() as any[];
  for (const row of logRows) {
    recentLogs.push(rowToLog(row));
  }

  const totRow = db.query(
    "SELECT SUM(input_tokens + output_tokens + cache_read + cache_creation) as total FROM request_logs"
  ).get() as any;
  totalTokensAllTime = totRow?.total ?? 0;

  console.log(`DB loaded: ${rows.length} token(s), ${logRows.length} log(s) from ${config.dbFile}`);
}

export function onShutdown(sig: string) {
  console.log(`Received ${sig}, closing DB...`);
  db.close();
  process.exit(0);
}
