import { Database } from "bun:sqlite";
import fs from "fs";
import path from "path";
import { config } from "./config";
import type { TokenEntry, UserEntry, UpstreamState, DailyUsage, RequestLogEntry, ModelRoute } from "./types";

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
  CREATE TABLE IF NOT EXISTS users (
    id          TEXT    PRIMARY KEY,
    name        TEXT    NOT NULL,
    description TEXT    NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS model_routes (
    model_id    TEXT    PRIMARY KEY,
    threshold   REAL    NOT NULL DEFAULT 0.90,
    action      TEXT    NOT NULL DEFAULT 'block',
    fallback_to TEXT
  );
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
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
try { db.exec("ALTER TABLE request_logs ADD COLUMN messages_json TEXT DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE request_logs ADD COLUMN response_text TEXT DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE request_logs ADD COLUMN name TEXT DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE tokens ADD COLUMN name TEXT DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE tokens ADD COLUMN mode TEXT NOT NULL DEFAULT 'inherit'"); } catch {} // kept for DB compat
try { db.exec("ALTER TABLE tokens ADD COLUMN provider TEXT NOT NULL DEFAULT 'inherit'"); } catch {}
try { db.exec("ALTER TABLE tokens ADD COLUMN user_id TEXT NOT NULL DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE request_logs ADD COLUMN user_id TEXT NOT NULL DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE daily_usage ADD COLUMN user_id TEXT NOT NULL DEFAULT ''"); } catch {}

// ── Prepared statements ───────────────────────────────────────────────────────
const stmts = {
  insertIgnore: db.prepare(`
    INSERT OR IGNORE INTO tokens (key, name, user_id, lim, win, used, window_start, paused, dynamic, provider)
    VALUES ($key, $name, $user_id, $lim, $win, $used, $window_start, $paused, $dynamic, $provider)
  `),
  insertReplace: db.prepare(`
    INSERT OR REPLACE INTO tokens (key, name, user_id, lim, win, used, window_start, paused, dynamic, deleted, provider)
    VALUES ($key, $name, $user_id, $lim, $win, $used, $window_start, $paused, $dynamic, 0, $provider)
  `),
  updateUsage: db.prepare(`UPDATE tokens SET used=$used WHERE key=$key`),
  updateToken:    db.prepare(`UPDATE tokens SET lim=$lim, win=$win, paused=$paused WHERE key=$key`),
  updateProvider: db.prepare(`UPDATE tokens SET provider=$provider WHERE key=$key`),
  updateName:     db.prepare(`UPDATE tokens SET name=$name WHERE key=$key`),
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
    INSERT INTO request_logs (ts, token_key, name, model, input_tokens, output_tokens, cache_read, cache_creation,
      stream, status, stop_reason, tool_use_count, duration_ms, turns, prompt, system_prompt, messages_json, response_text)
    VALUES ($ts, $key, $name, $model, $inp, $out, $cr, $cc, $stream, $status, $sr, $tuc, $dur, $turns, $prompt, $sys, $mj, $rt)
  `),
  pruneLog:    db.prepare(`DELETE FROM request_logs WHERE ts < $cutoff`),
  insertSession: db.prepare(`INSERT OR REPLACE INTO admin_sessions (token, created_at, last_used) VALUES ($token, $now, $now)`),
  touchSession:  db.prepare(`UPDATE admin_sessions SET last_used=$now WHERE token=$token`),
  checkSession:  db.prepare(`SELECT 1 FROM admin_sessions WHERE token=$token`),
  deleteSession: db.prepare(`DELETE FROM admin_sessions WHERE token=$token`),
  pruneSessions: db.prepare(`DELETE FROM admin_sessions WHERE last_used < $cutoff`),
  upsertUser:    db.prepare(`INSERT OR REPLACE INTO users (id, name, description, created_at) VALUES ($id, $name, $desc, $ts)`),
  updateUser:    db.prepare(`UPDATE users SET name=$name, description=$desc WHERE id=$id`),
  deleteUser:    db.prepare(`DELETE FROM users WHERE id=$id`),
  linkToken:     db.prepare(`UPDATE tokens SET user_id=$uid WHERE key=$key AND (user_id IS NULL OR user_id='')`),
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
  upsertRoute:  db.prepare(`
    INSERT OR REPLACE INTO model_routes (model_id, threshold, action, fallback_to)
    VALUES ($mid, $thr, $act, $fb)
  `),
  deleteRoute:  db.prepare(`DELETE FROM model_routes WHERE model_id=$mid`),
  upsertSetting: db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ($key, $value)`),
  getSetting:    db.prepare(`SELECT value FROM settings WHERE key=$key`),
};

// ── Runtime state ─────────────────────────────────────────────────────────────
export const tokens: Record<string, TokenEntry> = {};
export const users:  Record<string, UserEntry>  = {};
export const dailyUsage: DailyUsage = {};
export const recentLogs: RequestLogEntry[] = [];
export let totalTokensAllTime = 0;
export const allTimePerUser: Record<string, number> = {};

export const modelRoutes: Record<string, ModelRoute> = {};

export const upstream: UpstreamState = {
  fiveHour: null, sevenDay: null, sevenDaySonnet: null, sevenDayOpus: null,
  lastPoll: 0, lastPollOk: false, lastError: null,
  lastKnownResetsAt: null, detectedWindowMs: null, pollBackoffUntil: 0,
  tokenCache: { value: null, readAt: 0, email: null },
  fallbackActive: false, fallbackProvider: null,
};

export const settings: Record<string, string> = {};

// ── Helpers ───────────────────────────────────────────────────────────────────
function toLim(limit: number): number | null {
  return limit === Infinity ? null : limit;
}
function fromLim(lim: number | null): number {
  return lim === null ? Infinity : lim;
}

export function slugify(name: string): string {
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s || "user";
}

export function ensureUniqueSlug(base: string, existing: Record<string, unknown>): string {
  if (!existing[base]) return base;
  let i = 2;
  while (existing[`${base}-${i}`]) i++;
  return `${base}-${i}`;
}

// ── DB write functions ────────────────────────────────────────────────────────
export function deriveNameFromKey(key: string): string {
  // "sk-user-amel" → "amel", "mytoken" → "mytoken"
  const parts = key.split("-");
  return parts[parts.length - 1] || key;
}

export function dbInsertEnvToken(key: string, entry: TokenEntry) {
  stmts.insertIgnore.run({
    $key: key, $name: entry.name, $user_id: entry.user_id || "", $lim: toLim(entry.limit), $win: entry.window,
    $used: entry.used, $window_start: entry.windowStart,
    $paused: entry.paused ? 1 : 0, $dynamic: 0, $provider: entry.provider || "inherit",
  });
}

export function dbInsertToken(key: string, entry: TokenEntry) {
  stmts.insertReplace.run({
    $key: key, $name: entry.name, $user_id: entry.user_id || "", $lim: toLim(entry.limit), $win: entry.window,
    $used: entry.used, $window_start: entry.windowStart,
    $paused: entry.paused ? 1 : 0, $dynamic: entry.dynamic ? 1 : 0, $provider: entry.provider || "inherit",
  });
}

export function dbUpdateProvider(key: string, provider: string) {
  stmts.updateProvider.run({ $provider: provider, $key: key });
}

export function dbUpsertUser(entry: UserEntry) {
  stmts.upsertUser.run({ $id: entry.id, $name: entry.name, $desc: entry.description, $ts: entry.created_at });
}

export function dbUpdateUser(id: string, name: string, description: string) {
  stmts.updateUser.run({ $name: name, $desc: description, $id: id });
}

export function dbDeleteUser(id: string) {
  stmts.deleteUser.run({ $id: id });
}

export function dbLinkTokenToUser(key: string, userId: string) {
  stmts.linkToken.run({ $uid: userId, $key: key });
  db.query("UPDATE tokens SET user_id=? WHERE key=?").run(userId, key);
}

export function dbRenameToken(key: string, newName: string) {
  stmts.updateName.run({ $name: newName, $key: key });
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

export function dbSaveRoutes(routes: ModelRoute[]) {
  db.query("DELETE FROM model_routes").run();
  for (const r of routes) {
    stmts.upsertRoute.run({ $mid: r.model_id, $thr: r.threshold, $act: r.action, $fb: r.fallback_to });
  }
  // Sync in-memory
  for (const k of Object.keys(modelRoutes)) delete modelRoutes[k];
  for (const r of routes) modelRoutes[r.model_id] = r;
}

export function dbSaveSetting(key: string, value: string) {
  stmts.upsertSetting.run({ $key: key, $value: value });
  settings[key] = value;
}

export function dbGetSetting(key: string): string | null {
  const row = stmts.getSetting.get({ $key: key }) as any;
  return row?.value ?? null;
}

function loadSettings() {
  const rows = db.query("SELECT key, value FROM settings").all() as any[];
  for (const row of rows) settings[row.key] = row.value;
  if (rows.length) console.log(`Settings loaded: ${rows.length} key(s)`);
}

function dbLoadRoutes() {
  const rows = db.query("SELECT * FROM model_routes").all() as any[];
  for (const row of rows) {
    modelRoutes[row.model_id] = {
      model_id: row.model_id,
      threshold: row.threshold,
      action: row.action as "redirect" | "block",
      fallback_to: row.fallback_to || null,
    };
  }
  if (rows.length) console.log(`Model routes loaded: ${rows.length} rule(s)`);
}

export function dbLogRequest(entry: Omit<RequestLogEntry, "id">) {
  const uid = tokens[entry.token_key]?.user_id || entry.user_id || entry.token_key;
  const result = stmts.insertLog.run({
    $ts: entry.ts, $key: entry.token_key, $name: entry.name || "",
    $model: entry.model,
    $inp: entry.input_tokens, $out: entry.output_tokens,
    $cr: entry.cache_read || 0, $cc: entry.cache_creation || 0,
    $stream: entry.stream ? 1 : 0, $status: entry.status,
    $sr: entry.stop_reason || "", $tuc: entry.tool_use_count || 0,
    $dur: entry.duration_ms || 0, $turns: entry.turns || 0,
    $prompt: entry.prompt, $sys: entry.system_prompt || "",
    $mj: entry.messages_json || "", $rt: entry.response_text || "",
  });
  // Update user_id in the just-inserted log row
  if (uid) {
    db.query("UPDATE request_logs SET user_id=? WHERE id=?").run(uid, Number(result.lastInsertRowid));
  }
  totalTokensAllTime += entry.input_tokens + entry.output_tokens + (entry.cache_read || 0) + (entry.cache_creation || 0);
  allTimePerUser[uid] = (allTimePerUser[uid] || 0) + entry.input_tokens + entry.output_tokens;
  const full: RequestLogEntry = { id: Number(result.lastInsertRowid), ...entry, user_id: uid };
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
  const key = r.token_key || "";
  const name = r.name || deriveNameFromKey(key);
  return {
    id: r.id || 0, ts: r.ts || 0, token_key: key,
    user_id: r.user_id || tokens[key]?.user_id || "",
    name,
    model: r.model || "",
    input_tokens: r.input_tokens || 0, output_tokens: r.output_tokens || 0,
    cache_read: r.cache_read || 0, cache_creation: r.cache_creation || 0,
    stream: r.stream === 1, status: r.status || 200,
    stop_reason: r.stop_reason || "", tool_use_count: r.tool_use_count || 0,
    duration_ms: r.duration_ms || 0, turns: r.turns || 0,
    prompt: r.prompt || "", system_prompt: r.system_prompt || "",
    messages_json: r.messages_json || "", response_text: r.response_text || "",
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

export function dbGetTokenNames(): string[] {
  // Return unique display names from logs (falling back to last segment of key for old rows)
  try {
    const rows = db.query(
      "SELECT DISTINCT COALESCE(NULLIF(name, ''), token_key) AS n FROM request_logs ORDER BY n"
    ).all() as any[];
    return rows.map(r => r.n).filter(Boolean);
  } catch { return []; }
}

// ── Load from DB ──────────────────────────────────────────────────────────────
export function loadFromDb() {
  const now = Date.now();

  // Load users
  const userRows = db.query("SELECT * FROM users ORDER BY name ASC").all() as any[];
  for (const row of userRows) {
    users[row.id] = { id: row.id, name: row.name, description: row.description || "", created_at: row.created_at };
  }

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
      provider:    (row.provider as import("./types").TokenProvider) || "inherit",
      name:        row.name || deriveNameFromKey(row.key),
      user_id:     row.user_id || "",
    };
    // Persist derived name if not yet set in DB
    if (!row.name) stmts.updateName.run({ $name: tokens[row.key]!.name, $key: row.key });
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

  dbLoadRoutes();
  loadSettings();

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
  // Backfill name in request_logs for old rows — include deleted tokens
  const allTokenRows = db.query("SELECT key, name FROM tokens").all() as { key: string; name: string }[];
  for (const r of allTokenRows) {
    const n = r.name || deriveNameFromKey(r.key);
    db.query("UPDATE request_logs SET name = ? WHERE token_key = ? AND (name IS NULL OR name = '')")
      .run(n, r.key);
  }

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

  // Group alltime usage by user_id (with fallback to token_key for old rows)
  const perUserRows = db.query(`
    SELECT COALESCE(NULLIF(user_id,''), token_key) AS uid,
           SUM(input_tokens + output_tokens) as total
    FROM request_logs GROUP BY uid
  `).all() as { uid: string; total: number }[];
  for (const r of perUserRows) allTimePerUser[r.uid] = r.total ?? 0;

  console.log(`DB loaded: ${rows.length} token(s), ${logRows.length} log(s) from ${config.dbFile}`);
}

// ── Backfill users (run after loadFromDb + initFromEnv) ──────────────────────
// Idempotent: creates missing user entries for every token in memory and links
// request_logs + daily_usage rows. Safe to run on every startup.
export function backfillUsers() {
  const now = Date.now();

  // Active tokens (in-memory map, already loaded)
  for (const [key, tk] of Object.entries(tokens)) {
    const uid = tk.user_id || ensureUniqueSlug(slugify(tk.name), users);
    if (!users[uid]) {
      const entry: UserEntry = { id: uid, name: tk.name, description: "", created_at: now };
      users[uid] = entry;
      stmts.upsertUser.run({ $id: uid, $name: tk.name, $desc: "", $ts: now });
    }
    if (!tk.user_id) {
      tk.user_id = uid;
      db.query("UPDATE tokens SET user_id=? WHERE key=?").run(uid, key);
    }
    // Backfill logs + daily_usage for this active token
    db.query("UPDATE request_logs SET user_id=? WHERE token_key=? AND (user_id IS NULL OR user_id='')").run(uid, key);
    db.query("UPDATE daily_usage   SET user_id=? WHERE token_key=? AND (user_id IS NULL OR user_id='')").run(uid, key);
  }

  // Deleted tokens — backfill logs without creating new user entries
  const deletedRows = db.query("SELECT key, name, user_id FROM tokens WHERE deleted=1").all() as any[];
  for (const r of deletedRows) {
    const uid = r.user_id || slugify(r.name || deriveNameFromKey(r.key));
    if (!uid) continue;
    db.query("UPDATE request_logs SET user_id=? WHERE token_key=? AND (user_id IS NULL OR user_id='')").run(uid, r.key);
    db.query("UPDATE daily_usage   SET user_id=? WHERE token_key=? AND (user_id IS NULL OR user_id='')").run(uid, r.key);
  }

  // Reload allTimePerUser after backfill (user_id is now set in request_logs)
  const perUserRows = db.query(`
    SELECT COALESCE(NULLIF(user_id,''), token_key) AS uid,
           SUM(input_tokens + output_tokens) as total
    FROM request_logs GROUP BY uid
  `).all() as { uid: string; total: number }[];
  for (const r of perUserRows) allTimePerUser[r.uid] = r.total ?? 0;

  console.log(`Users backfill done: ${Object.keys(users).length} user(s)`);
}

export function onShutdown(sig: string) {
  console.log(`Received ${sig}, closing DB...`);
  db.close();
  process.exit(0);
}
