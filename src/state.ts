import { eq, and, gte, lt, sql, isNull, or, desc, asc, count, sum, avg, ne } from "drizzle-orm";
import { db } from "./db";
import {
  tokens as tokensTable,
  requestLogs as requestLogsTable,
  dailyUsage as dailyUsageTable,
  upstreamState as upstreamStateTable,
  users as usersTable,
  modelRoutes as modelRoutesTable,
  settings as settingsTable,
} from "./schema";
import { config } from "./config";
import type { TokenEntry, UserEntry, UpstreamState, DailyUsage, RequestLogEntry, ModelRoute } from "./types";

// ── Runtime state (in-memory, same as before) ─────────────────────────────────
export const tokens: Record<string, TokenEntry> = {};
export const users:  Record<string, UserEntry>  = {};
export const dailyUsage: DailyUsage = {};
export const recentLogs: RequestLogEntry[] = [];
export let totalTokensAllTime = 0;
export const allTimePerUser: Record<string, number> = {};
export const modelRoutes: Record<string, ModelRoute> = {};
export const settings: Record<string, string> = {};

export const upstream: UpstreamState = {
  fiveHour: null, sevenDay: null, sevenDaySonnet: null, sevenDayOpus: null,
  lastPoll: 0, lastPollOk: false, lastError: null,
  lastKnownResetsAt: null, detectedWindowMs: null, pollBackoffUntil: 0,
  tokenCache: { value: null, readAt: 0, email: null },
  fallbackActive: false, fallbackProvider: null,
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function toLim(limit: number): number | null {
  return limit === Infinity ? null : limit;
}
function fromLim(lim: number | null | undefined): number {
  return lim === null || lim === undefined ? Infinity : lim;
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

export function deriveNameFromKey(key: string): string {
  const parts = key.split("-");
  return parts[parts.length - 1] || key;
}

export function resolveTokenName(key: string, tk?: TokenEntry): string {
  if (tk?.user_id && users[tk.user_id]) {
    return users[tk.user_id].name || users[tk.user_id].email || tk.user_id;
  }
  if (tk?.name) return tk.name;
  return deriveNameFromKey(key);
}

function rowToLog(r: any): RequestLogEntry {
  const key  = r.token_key || "";
  const name = r.name || deriveNameFromKey(key);
  return {
    id:             r.id || 0,
    ts:             typeof r.ts === "bigint" ? Number(r.ts) : (r.ts || 0),
    token_key:      key,
    user_id:        r.user_id || tokens[key]?.user_id || "",
    name,
    model:          r.model || "",
    input_tokens:   r.input_tokens || 0,
    output_tokens:  r.output_tokens || 0,
    cache_read:     r.cache_read || 0,
    cache_creation: r.cache_creation || 0,
    stream:         r.stream === true || r.stream === 1,
    status:         r.status || 200,
    stop_reason:    r.stop_reason || "",
    tool_use_count: r.tool_use_count || 0,
    duration_ms:    r.duration_ms || 0,
    turns:          r.turns || 0,
    prompt:         r.prompt || "",
    system_prompt:  r.system_prompt || "",
    messages_json:  r.messages_json || "",
    response_text:  r.response_text || "",
  };
}

// ── DB write functions ────────────────────────────────────────────────────────

export async function dbInsertEnvToken(key: string, entry: TokenEntry) {
  await db.insert(tokensTable).values({
    key, name: entry.name, user_id: entry.user_id || "",
    lim: toLim(entry.limit), win: entry.window, used: entry.used,
    window_start: entry.windowStart,
    paused: entry.paused, dynamic: false, provider: entry.provider || "inherit",
  }).onConflictDoNothing();
}

export async function dbInsertToken(key: string, entry: TokenEntry) {
  await db.insert(tokensTable).values({
    key, name: entry.name, user_id: entry.user_id || "",
    lim: toLim(entry.limit), win: entry.window, used: entry.used,
    window_start: entry.windowStart,
    paused: entry.paused, dynamic: entry.dynamic, deleted: false,
    provider: entry.provider || "inherit",
  }).onConflictDoUpdate({
    target: tokensTable.key,
    set: {
      name: entry.name, user_id: entry.user_id || "",
      lim: toLim(entry.limit), win: entry.window, used: entry.used,
      window_start: entry.windowStart,
      paused: entry.paused, dynamic: entry.dynamic, deleted: false,
      provider: entry.provider || "inherit",
    },
  });
}

export async function dbUpdateProvider(key: string, provider: string) {
  await db.update(tokensTable).set({ provider }).where(eq(tokensTable.key, key));
}

export async function dbUpsertUser(entry: UserEntry) {
  await db.insert(usersTable).values({
    id: entry.id, name: entry.name, email: entry.email || "",
    description: entry.description, created_at: entry.created_at,
    role: entry.role || "USER",
  }).onConflictDoUpdate({
    target: usersTable.id,
    set: { name: entry.name, email: entry.email || "", description: entry.description, role: entry.role || "USER" },
  });
}

export async function dbSetUserRole(id: string, role: import("./types").UserRole) {
  await db.update(usersTable).set({ role }).where(eq(usersTable.id, id));
  if (users[id]) users[id]!.role = role;
}

export async function dbUpdateUser(id: string, name: string, description: string) {
  await db.update(usersTable).set({ name, description }).where(eq(usersTable.id, id));
}

export async function dbDeleteUser(id: string) {
  await db.delete(usersTable).where(eq(usersTable.id, id));
}

export async function dbLinkTokenToUser(key: string, userId: string) {
  await db.update(tokensTable)
    .set({ user_id: userId })
    .where(and(eq(tokensTable.key, key), or(isNull(tokensTable.user_id), eq(tokensTable.user_id, ""))));
  // also unconditional update to handle race
  await db.update(tokensTable).set({ user_id: userId }).where(eq(tokensTable.key, key));
}

export async function dbRenameToken(key: string, newName: string) {
  await db.update(tokensTable).set({ name: newName }).where(eq(tokensTable.key, key));
}

export async function dbUpdateUsage(key: string, used: number) {
  await db.update(tokensTable).set({ used }).where(eq(tokensTable.key, key));
}

export async function dbUpdateToken(key: string, entry: TokenEntry) {
  await db.update(tokensTable)
    .set({ lim: toLim(entry.limit), win: entry.window, paused: entry.paused })
    .where(eq(tokensTable.key, key));
}

export async function dbSoftDelete(key: string) {
  await db.update(tokensTable).set({ deleted: true }).where(eq(tokensTable.key, key));
}

export async function dbResetToken(key: string, windowStart: number) {
  await db.update(tokensTable).set({ used: 0, window_start: windowStart }).where(eq(tokensTable.key, key));
}

export async function dbResetAllTokens(win: number, windowStart: number) {
  await db.update(tokensTable).set({ used: 0, win, window_start: windowStart }).where(eq(tokensTable.deleted, false));
}

export async function dbAlignAllTokens(win: number, windowStart: number) {
  await db.update(tokensTable).set({ win, window_start: windowStart }).where(eq(tokensTable.deleted, false));
}

export async function dbUpsertDailyUsage(date: string, key: string, delta: number) {
  await db.insert(dailyUsageTable).values({ date, token_key: key, used: delta })
    .onConflictDoUpdate({
      target: [dailyUsageTable.date, dailyUsageTable.token_key],
      set: { used: sql`${dailyUsageTable.used} + ${delta}` },
    });
}

export async function dbSaveUpstream() {
  await db.insert(upstreamStateTable).values({
    id: 1,
    last_known_resets_at: upstream.lastKnownResetsAt,
    detected_window_ms:   upstream.detectedWindowMs,
    last_poll:            upstream.lastPoll || null,
    five_hour_util:       upstream.fiveHour?.utilization   ?? null,
    five_hour_resets_at:  upstream.fiveHour?.resets_at     ?? null,
    seven_day_util:       upstream.sevenDay?.utilization   ?? null,
    seven_day_resets_at:  upstream.sevenDay?.resets_at     ?? null,
    sonnet_util:          upstream.sevenDaySonnet?.utilization ?? null,
    sonnet_resets_at:     upstream.sevenDaySonnet?.resets_at   ?? null,
    opus_util:            upstream.sevenDayOpus?.utilization   ?? null,
    opus_resets_at:       upstream.sevenDayOpus?.resets_at     ?? null,
  }).onConflictDoUpdate({
    target: upstreamStateTable.id,
    set: {
      last_known_resets_at: upstream.lastKnownResetsAt,
      detected_window_ms:   upstream.detectedWindowMs,
      last_poll:            upstream.lastPoll || null,
      five_hour_util:       upstream.fiveHour?.utilization   ?? null,
      five_hour_resets_at:  upstream.fiveHour?.resets_at     ?? null,
      seven_day_util:       upstream.sevenDay?.utilization   ?? null,
      seven_day_resets_at:  upstream.sevenDay?.resets_at     ?? null,
      sonnet_util:          upstream.sevenDaySonnet?.utilization ?? null,
      sonnet_resets_at:     upstream.sevenDaySonnet?.resets_at   ?? null,
      opus_util:            upstream.sevenDayOpus?.utilization   ?? null,
      opus_resets_at:       upstream.sevenDayOpus?.resets_at     ?? null,
    },
  });
}

export async function dbSaveRoutes(routes: ModelRoute[]) {
  await db.delete(modelRoutesTable);
  if (routes.length > 0) {
    await db.insert(modelRoutesTable).values(routes.map(r => ({
      model_id: r.model_id, threshold: r.threshold,
      action: r.action, fallback_to: r.fallback_to,
    })));
  }
  for (const k of Object.keys(modelRoutes)) delete modelRoutes[k];
  for (const r of routes) modelRoutes[r.model_id] = r;
}

export async function dbSaveSetting(key: string, value: string) {
  await db.insert(settingsTable).values({ key, value })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value } });
  settings[key] = value;
}

export async function dbGetSetting(key: string): Promise<string | null> {
  const row = await db.select().from(settingsTable).where(eq(settingsTable.key, key)).limit(1);
  return row[0]?.value ?? null;
}

export async function dbLogRequest(entry: Omit<RequestLogEntry, "id">) {
  const uid = tokens[entry.token_key]?.user_id || entry.user_id || entry.token_key;
  const [inserted] = await db.insert(requestLogsTable).values({
    ts:             entry.ts,
    token_key:      entry.token_key,
    name:           entry.name || "",
    user_id:        uid,
    model:          entry.model,
    input_tokens:   entry.input_tokens,
    output_tokens:  entry.output_tokens,
    cache_read:     entry.cache_read || 0,
    cache_creation: entry.cache_creation || 0,
    stream:         entry.stream,
    status:         entry.status,
    stop_reason:    entry.stop_reason || "",
    tool_use_count: entry.tool_use_count || 0,
    duration_ms:    entry.duration_ms || 0,
    turns:          entry.turns || 0,
    prompt:         entry.prompt,
    system_prompt:  entry.system_prompt || "",
    messages_json:  entry.messages_json || "",
    response_text:  entry.response_text || "",
  }).returning({ id: requestLogsTable.id });

  totalTokensAllTime += entry.input_tokens + entry.output_tokens + (entry.cache_read || 0) + (entry.cache_creation || 0);
  allTimePerUser[uid] = (allTimePerUser[uid] || 0) + entry.input_tokens + entry.output_tokens;
  const full: RequestLogEntry = { id: inserted!.id, ...entry, user_id: uid };
  recentLogs.unshift(full);
  if (recentLogs.length > 200) recentLogs.pop();
}

export async function dbQueryLogs(page: number, limit: number, user: string): Promise<RequestLogEntry[]> {
  try {
    const offset = (page - 1) * limit;
    const rows = user
      ? await db.select().from(requestLogsTable)
          .where(eq(requestLogsTable.token_key, user))
          .orderBy(desc(requestLogsTable.ts))
          .limit(limit).offset(offset)
      : await db.select().from(requestLogsTable)
          .orderBy(desc(requestLogsTable.ts))
          .limit(limit).offset(offset);
    return rows.map(rowToLog);
  } catch { return []; }
}

export async function dbCountLogs(user: string): Promise<number> {
  try {
    const [row] = user
      ? await db.select({ n: count() }).from(requestLogsTable).where(eq(requestLogsTable.token_key, user))
      : await db.select({ n: count() }).from(requestLogsTable);
    return row?.n ?? 0;
  } catch { return 0; }
}

export async function dbGetLog(id: number): Promise<RequestLogEntry | null> {
  try {
    const [row] = await db.select().from(requestLogsTable).where(eq(requestLogsTable.id, id)).limit(1);
    return row ? rowToLog(row) : null;
  } catch { return null; }
}

export async function dbClearLogs(user?: string) {
  if (user) {
    await db.delete(requestLogsTable).where(eq(requestLogsTable.token_key, user));
    let i = recentLogs.findIndex(l => l.token_key === user);
    while (i >= 0) { recentLogs.splice(i, 1); i = recentLogs.findIndex(l => l.token_key === user); }
  } else {
    await db.delete(requestLogsTable);
    recentLogs.splice(0, recentLogs.length);
  }
}

export async function dbGetTokenKeys(): Promise<string[]> {
  try {
    const rows = await db.selectDistinct({ token_key: requestLogsTable.token_key })
      .from(requestLogsTable)
      .orderBy(asc(requestLogsTable.token_key));
    return rows.map(r => r.token_key).filter(Boolean);
  } catch { return []; }
}

export async function dbGetTokenNames(): Promise<string[]> {
  try {
    const rows = await db.execute(sql`
      SELECT DISTINCT COALESCE(NULLIF(name, ''), token_key) AS n
      FROM request_logs ORDER BY n
    `);
    return (rows.rows as any[]).map(r => r.n).filter(Boolean);
  } catch { return []; }
}

// ── Load from DB (async, called once at startup) ───────────────────────────────
export async function loadFromDb() {
  const now = Date.now();

  // Load users
  const userRows = await db.select().from(usersTable).orderBy(asc(usersTable.name));
  for (const row of userRows) {
    users[row.id] = {
      id: row.id, name: row.name, email: row.email || "",
      description: row.description || "", created_at: Number(row.created_at),
      role: (row.role as import("./types").UserRole) || "USER",
    };
  }

  // Load tokens
  const tokenRows = await db.select().from(tokensTable).where(eq(tokensTable.deleted, false));
  for (const row of tokenRows) {
    const win     = Number(row.win);
    const ws      = Number(row.window_start);
    const expired = now - ws >= win;
    tokens[row.key] = {
      limit:       fromLim(row.lim),
      window:      win,
      used:        expired ? 0 : (row.used || 0),
      windowStart: expired ? now : ws,
      paused:      row.paused,
      dynamic:     row.dynamic,
      mode:        "inherit",
      provider:    (row.provider as import("./types").TokenProvider) || "inherit",
      name:        row.name || deriveNameFromKey(row.key),
      user_id:     row.user_id || "",
    };
    if (!row.name) {
      await db.update(tokensTable).set({ name: tokens[row.key]!.name }).where(eq(tokensTable.key, row.key));
    }
    if (expired) {
      await db.update(tokensTable).set({ used: 0, window_start: now }).where(eq(tokensTable.key, row.key));
    }
  }

  // Load upstream state
  const [up] = await db.select().from(upstreamStateTable).where(eq(upstreamStateTable.id, 1)).limit(1);
  if (up) {
    if (up.last_known_resets_at) upstream.lastKnownResetsAt = up.last_known_resets_at;
    if (up.detected_window_ms)   upstream.detectedWindowMs  = Number(up.detected_window_ms);
    if (up.last_poll)            upstream.lastPoll           = Number(up.last_poll);
    if (up.five_hour_util  != null) upstream.fiveHour       = { utilization: up.five_hour_util!,  resets_at: up.five_hour_resets_at! };
    if (up.seven_day_util  != null) upstream.sevenDay       = { utilization: up.seven_day_util!,  resets_at: up.seven_day_resets_at! };
    if (up.sonnet_util     != null) upstream.sevenDaySonnet = { utilization: up.sonnet_util!,     resets_at: up.sonnet_resets_at! };
    if (up.opus_util       != null) upstream.sevenDayOpus   = { utilization: up.opus_util!,       resets_at: up.opus_resets_at! };
    if (up.detected_window_ms) {
      const wms = Number(up.detected_window_ms);
      for (const tk of Object.values(tokens)) tk.window = wms;
    }
  }

  // Load model routes
  const routeRows = await db.select().from(modelRoutesTable);
  for (const row of routeRows) {
    modelRoutes[row.model_id] = {
      model_id:    row.model_id,
      threshold:   row.threshold,
      action:      row.action as "redirect" | "block",
      fallback_to: row.fallback_to || null,
    };
  }
  if (routeRows.length) console.log(`Model routes loaded: ${routeRows.length} rule(s)`);

  // Load settings
  const settingRows = await db.select().from(settingsTable);
  for (const row of settingRows) settings[row.key] = row.value;
  if (settingRows.length) console.log(`Settings loaded: ${settingRows.length} key(s)`);

  // Prune old daily usage (keep 30 days)
  const cutoff = new Date(now - 30 * 86400000).toISOString().slice(0, 10);
  await db.delete(dailyUsageTable).where(lt(dailyUsageTable.date, cutoff));

  // Load daily usage
  const usageRows = await db.select().from(dailyUsageTable).where(gte(dailyUsageTable.date, cutoff));
  for (const row of usageRows) {
    if (!dailyUsage[row.date]) dailyUsage[row.date] = {};
    dailyUsage[row.date][row.token_key] = row.used;
  }

  // Prune old request logs (keep 30 days)
  const logCutoff = now - 30 * 86400000;
  await db.delete(requestLogsTable).where(lt(requestLogsTable.ts, logCutoff));

  // Backfill name in request_logs for old rows
  const allTokenRows = await db.select({ key: tokensTable.key, name: tokensTable.name }).from(tokensTable);
  for (const r of allTokenRows) {
    const n = r.name || deriveNameFromKey(r.key);
    await db.update(requestLogsTable)
      .set({ name: n })
      .where(and(eq(requestLogsTable.token_key, r.key), or(isNull(requestLogsTable.name as any), eq(requestLogsTable.name, ""))));
  }

  // Load recent logs (last 200)
  const logRows = await db.select().from(requestLogsTable)
    .orderBy(desc(requestLogsTable.ts)).limit(200);
  for (const row of logRows) recentLogs.push(rowToLog(row));

  // Total tokens all time
  const totResult = await db.execute(sql`
    SELECT SUM(input_tokens + output_tokens + cache_read + cache_creation) as total FROM request_logs
  `);
  const totRow = ((totResult as any).rows ?? [])[0];
  totalTokensAllTime = Number(totRow?.total ?? 0);

  // All time per user
  const perUserResult = await db.execute(sql`
    SELECT COALESCE(NULLIF(user_id,''), token_key) AS uid,
           SUM(input_tokens + output_tokens) as total
    FROM request_logs GROUP BY uid
  `);
  for (const r of (perUserResult as any).rows ?? []) allTimePerUser[r.uid] = Number(r.total) ?? 0;

  console.log(`DB loaded: ${tokenRows.length} token(s), ${logRows.length} log(s)`);
}

// ── Backfill users ────────────────────────────────────────────────────────────
export async function backfillUsers() {
  const now = Date.now();

  for (const [key, tk] of Object.entries(tokens)) {
    let uid = tk.user_id;
    if (!uid) {
      const base = slugify(tk.name);
      uid = users[base] ? base : ensureUniqueSlug(base, users);
    }
    if (!users[uid]) {
      const entry: UserEntry = { id: uid, name: tk.name, email: "", description: "", created_at: now, role: "USER" };
      users[uid] = entry;
      await db.insert(usersTable).values({ id: uid, name: tk.name, email: "", description: "", created_at: now, role: "USER" })
        .onConflictDoNothing();
    }
    if (!tk.user_id) {
      tk.user_id = uid;
      await db.update(tokensTable).set({ user_id: uid }).where(eq(tokensTable.key, key));
    }
    await db.update(requestLogsTable)
      .set({ user_id: uid })
      .where(and(eq(requestLogsTable.token_key, key), or(isNull(requestLogsTable.user_id as any), eq(requestLogsTable.user_id, ""))));
    await db.update(dailyUsageTable)
      .set({ user_id: uid })
      .where(and(eq(dailyUsageTable.token_key, key), or(isNull(dailyUsageTable.user_id as any), eq(dailyUsageTable.user_id, ""))));
  }

  // Deleted tokens
  const deletedRows = await db.select({ key: tokensTable.key, name: tokensTable.name, user_id: tokensTable.user_id })
    .from(tokensTable).where(eq(tokensTable.deleted, true));
  for (const r of deletedRows) {
    const uid = r.user_id || slugify(r.name || deriveNameFromKey(r.key));
    if (!uid) continue;
    await db.update(requestLogsTable)
      .set({ user_id: uid })
      .where(and(eq(requestLogsTable.token_key, r.key), or(isNull(requestLogsTable.user_id as any), eq(requestLogsTable.user_id, ""))));
    await db.update(dailyUsageTable)
      .set({ user_id: uid })
      .where(and(eq(dailyUsageTable.token_key, r.key), or(isNull(dailyUsageTable.user_id as any), eq(dailyUsageTable.user_id, ""))));
  }

  // Reload allTimePerUser after backfill
  const perUserRows = await db.execute(sql`
    SELECT COALESCE(NULLIF(user_id,''), token_key) AS uid,
           SUM(input_tokens + output_tokens) as total
    FROM request_logs GROUP BY uid
  `);
  for (const r of (perUserRows as any).rows ?? []) allTimePerUser[r.uid] = Number(r.total) ?? 0;

  // Sync SUPER_ADMIN_EMAILS
  for (const u of Object.values(users)) {
    if (u.email && config.superAdminEmails.has(u.email.toLowerCase()) && u.role !== "SUPER_ADMIN") {
      u.role = "SUPER_ADMIN";
      await db.update(usersTable).set({ role: "SUPER_ADMIN" }).where(eq(usersTable.id, u.id));
    }
  }

  console.log(`Users backfill done: ${Object.keys(users).length} user(s)`);
}

export async function onShutdown(sig: string) {
  console.log(`Received ${sig}, closing DB pool...`);
  const { closeDb } = await import("./db");
  await closeDb();
  process.exit(0);
}
