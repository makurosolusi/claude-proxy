import { prisma } from "./prisma";
import { config } from "./config";
import { localDateStr } from "./date";
import { derivePinnedModel } from "./modelAllowlist";
import type { TokenEntry, UserEntry, UpstreamState, DailyUsage, RequestLogEntry } from "./types";

// ── Runtime state (in-memory) ─────────────────────────────────────────────────
export const tokens: Record<string, TokenEntry> = {};
export const users:  Record<string, UserEntry>  = {};
export const dailyUsage: DailyUsage = {};
export const recentLogs: RequestLogEntry[] = [];
export let totalTokensAllTime = 0;
export const allTimePerUser: Record<string, number> = {};
export const settings: Record<string, string> = {};

export const upstream: UpstreamState = {
  fiveHour: null, sevenDay: null, sevenDaySonnet: null, sevenDayOpus: null,
  lastPoll: 0, lastPollOk: false, lastError: null,
  lastKnownResetsAt: null, detectedWindowMs: null, pollBackoffUntil: 0,
  tokenCache: { value: null, readAt: 0, email: null },
  fallbackActive: false, fallbackProvider: null,
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function toLim(limit: number): bigint | null {
  return limit === Infinity ? null : BigInt(limit);
}
function fromLim(lim: bigint | null | undefined): number {
  return lim === null || lim === undefined ? Infinity : Number(lim);
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

// Best-effort display name combining label + owner. Used where a single string
// is needed (logs, alerts). Public/Live Feed views should prefer the explicit
// resolveOwnerName + resolveTokenLabel pair for the user→token hierarchy.
export function resolveTokenName(key: string, tk?: TokenEntry): string {
  if (tk?.label) return tk.label;
  const owner = resolveOwnerName(tk);
  if (owner) return owner;
  return deriveNameFromKey(key);
}

// Owner identity — name of the human who owns the token. Empty when orphan/anonymous.
// Image lookup is done at the frontend via userImages map keyed by owner name.
export function resolveOwnerName(tk?: TokenEntry): string {
  if (tk?.user_id && users[tk.user_id]) {
    return users[tk.user_id].name || users[tk.user_id].email || "";
  }
  return "";
}

// Token routing label — distinct from owner identity. Returns empty string when
// no explicit label is set; callers decide how to render unlabeled tokens
// (typically as model/provider info). NOTE: tk.name is a legacy mirror of
// user.name and is deliberately NOT used as fallback, since that would duplicate
// the owner display in the new user→token hierarchy.
export function resolveTokenLabel(_key: string, tk?: TokenEntry): string {
  return tk?.label || "";
}

function rowToLog(r: any): RequestLogEntry {
  const key  = r.token_key || "";
  const tk   = tokens[key];
  const name = r.name || deriveNameFromKey(key);
  const ownerName  = resolveOwnerName(tk);
  const tokenLabel = resolveTokenLabel(key, tk);
  return {
    id:             r.id || 0,
    ts:             typeof r.ts === "bigint" ? Number(r.ts) : (r.ts || 0),
    token_key:      key,
    user_id:        r.user_id || tk?.user_id || "",
    name,
    owner_name:     ownerName,
    token_label:    tokenLabel,
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
  await prisma.tokens.upsert({
    where: { key },
    create: {
      key, user_id: entry.user_id || "",
      lim: toLim(entry.limit), win: BigInt(entry.window), used: BigInt(entry.used),
      window_start: BigInt(entry.windowStart),
      paused: entry.paused, dynamic: false, provider: entry.provider || "inherit",
      label: entry.label || "", description: entry.description || "", pinned_model: entry.pinned_model || "",
      allowed_models: entry.allowed_models ?? [],
      last_reset: entry.last_reset ? BigInt(entry.last_reset) : null,
    },
    update: {}, // do nothing on conflict
  });
}

export async function dbInsertToken(key: string, entry: TokenEntry) {
  await prisma.tokens.upsert({
    where: { key },
    create: {
      key, user_id: entry.user_id || "",
      lim: toLim(entry.limit), win: BigInt(entry.window), used: BigInt(entry.used),
      window_start: BigInt(entry.windowStart),
      paused: entry.paused, dynamic: entry.dynamic, deleted: false,
      provider: entry.provider || "inherit",
      label: entry.label || "", description: entry.description || "", pinned_model: entry.pinned_model || "",
      allowed_models: entry.allowed_models ?? [],
      last_reset: entry.last_reset ? BigInt(entry.last_reset) : null,
    },
    update: {
      user_id: entry.user_id || "",
      lim: toLim(entry.limit), win: BigInt(entry.window), used: BigInt(entry.used),
      window_start: BigInt(entry.windowStart),
      paused: entry.paused, dynamic: entry.dynamic, deleted: false,
      provider: entry.provider || "inherit",
      label: entry.label || "", description: entry.description || "", pinned_model: entry.pinned_model || "",
      allowed_models: entry.allowed_models ?? [],
      last_reset: entry.last_reset ? BigInt(entry.last_reset) : null,
    },
  });
}

export async function dbUpdateTokenMeta(key: string, label: string, description: string) {
  await prisma.tokens.update({ where: { key }, data: { label, description } });
}

export async function dbUpdatePinnedModel(key: string, pinned_model: string) {
  await prisma.tokens.update({ where: { key }, data: { pinned_model } });
}

// pinned_model is written as a derived mirror so DB and API never disagree;
// the app itself only ever reads allowed_models.
export async function dbUpdateAllowedModels(key: string, allowed_models: string[]) {
  await prisma.tokens.update({
    where: { key },
    data: { allowed_models, pinned_model: derivePinnedModel(allowed_models) },
  });
}

export async function dbUpdateProvider(key: string, provider: string) {
  await prisma.tokens.update({ where: { key }, data: { provider } });
}

export async function dbUpdateOutputType(key: string, output_type: string) {
  await prisma.tokens.update({ where: { key }, data: { output_type } });
  if (tokens[key]) tokens[key].output_type = output_type;
}

export async function dbUpsertUser(entry: UserEntry) {
  await prisma.users.upsert({
    where: { id: entry.id },
    create: {
      id: entry.id, name: entry.name, email: entry.email || "",
      description: entry.description, created_at: BigInt(entry.created_at),
      role: entry.role || "USER", status: entry.status || "pending",
    },
    update: { name: entry.name, email: entry.email || "", description: entry.description, role: entry.role || "USER", status: entry.status || "pending" },
  });
}

export async function dbSetUserRole(id: string, role: import("./types").UserRole) {
  await prisma.users.update({ where: { id }, data: { role } });
  if (users[id]) users[id]!.role = role;
}

export async function dbSetUserStatus(id: string, status: import("./types").UserStatus) {
  await prisma.users.update({ where: { id }, data: { status } });
  if (users[id]) users[id]!.status = status;
}

export async function dbSetContextBlock(id: string, reason: string) {
  const now = Date.now();
  await prisma.users.update({ where: { id }, data: { context_blocked_at: BigInt(now), context_block_reason: reason, context_block_grace_until: null } });
  if (users[id]) { users[id]!.context_blocked_at = now; users[id]!.context_block_reason = reason; delete users[id]!.context_block_grace_until; }
}

const GRACE_MS = 30 * 60 * 1000; // 30 menit

export async function dbClearContextBlock(id: string) {
  const graceUntil = Date.now() + GRACE_MS;
  await prisma.users.update({ where: { id }, data: { context_blocked_at: null, context_block_reason: null, context_block_grace_until: BigInt(graceUntil) } });
  if (users[id]) { delete users[id]!.context_blocked_at; delete users[id]!.context_block_reason; users[id]!.context_block_grace_until = graceUntil; }
}

export async function dbSetContextGrace(id: string, minutes: number) {
  const graceUntil = Date.now() + minutes * 60 * 1000;
  await prisma.users.update({ where: { id }, data: { context_block_grace_until: BigInt(graceUntil) } });
  if (users[id]) users[id]!.context_block_grace_until = graceUntil;
}

export async function dbUpdateUser(id: string, name: string, description: string) {
  await prisma.users.update({ where: { id }, data: { name, description } });
}

export async function dbDeleteUser(id: string) {
  await prisma.users.delete({ where: { id } });
}

export async function dbLinkTokenToUser(key: string, userId: string) {
  await prisma.tokens.update({ where: { key }, data: { user_id: userId } });
}

export async function dbUpdateUsage(key: string, used: number) {
  await prisma.tokens.update({ where: { key }, data: { used: BigInt(used) } });
}

export async function dbUpdateToken(key: string, entry: TokenEntry) {
  await prisma.tokens.update({
    where: { key },
    data: { lim: toLim(entry.limit), win: BigInt(entry.window), paused: entry.paused },
  });
}

export async function dbSoftDelete(key: string) {
  await prisma.tokens.update({ where: { key }, data: { deleted: true } });
}

export async function dbResetToken(key: string, windowStart: number) {
  await prisma.tokens.update({
    where: { key },
    data: { used: BigInt(0), window_start: BigInt(windowStart), last_reset: BigInt(windowStart) },
  });
}

// Window-rotation reset (called from upstream.ts when Anthropic 5h window
// rotates). Caller checks settings.reset_mode and skips entirely when it isn't
// "auto", so this updateMany unconditionally touches every active token.
export async function dbResetAllTokens(win: number, windowStart: number) {
  await prisma.tokens.updateMany({
    where: { deleted: false },
    data: { used: BigInt(0), win: BigInt(win), window_start: BigInt(windowStart), last_reset: BigInt(windowStart) },
  });
}

// First-poll alignment — sets window length + windowStart for tokens. Caller
// gates this on settings.reset_mode === "auto"; here it just runs the SQL.
export async function dbAlignAllTokens(win: number, windowStart: number) {
  await prisma.tokens.updateMany({
    where: { deleted: false },
    data: { win: BigInt(win), window_start: BigInt(windowStart) },
  });
}

export async function dbUpsertDailyUsage(date: string, key: string, delta: number) {
  // Prisma tidak support atomic increment via upsert — pakai raw SQL
  await prisma.$executeRaw`
    INSERT INTO daily_usage (date, token_key, used)
    VALUES (${date}, ${key}, ${delta})
    ON CONFLICT (date, token_key) DO UPDATE SET used = daily_usage.used + ${delta}
  `;
}

export async function dbSaveUpstream() {
  await prisma.upstream_state.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      last_known_resets_at: upstream.lastKnownResetsAt,
      detected_window_ms:   upstream.detectedWindowMs ? BigInt(upstream.detectedWindowMs) : null,
      last_poll:            upstream.lastPoll ? BigInt(upstream.lastPoll) : null,
      five_hour_util:       upstream.fiveHour?.utilization   ?? null,
      five_hour_resets_at:  upstream.fiveHour?.resets_at     ?? null,
      seven_day_util:       upstream.sevenDay?.utilization   ?? null,
      seven_day_resets_at:  upstream.sevenDay?.resets_at     ?? null,
      sonnet_util:          upstream.sevenDaySonnet?.utilization ?? null,
      sonnet_resets_at:     upstream.sevenDaySonnet?.resets_at   ?? null,
      opus_util:            upstream.sevenDayOpus?.utilization   ?? null,
      opus_resets_at:       upstream.sevenDayOpus?.resets_at     ?? null,
    },
    update: {
      last_known_resets_at: upstream.lastKnownResetsAt,
      detected_window_ms:   upstream.detectedWindowMs ? BigInt(upstream.detectedWindowMs) : null,
      last_poll:            upstream.lastPoll ? BigInt(upstream.lastPoll) : null,
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

export async function dbSaveSetting(key: string, value: string) {
  await prisma.settings.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
  settings[key] = value;
}

export async function dbGetSetting(key: string): Promise<string | null> {
  const row = await prisma.settings.findUnique({ where: { key } });
  return row?.value ?? null;
}

// Projection-only fields (owner_name, token_label) are resolved at insert time
// from runtime token state, not stored in the DB.
export async function dbLogRequest(entry: Omit<RequestLogEntry, "id" | "owner_name" | "token_label">) {
  const tk  = tokens[entry.token_key];
  const uid = tk?.user_id || entry.user_id || entry.token_key;
  const inserted = await prisma.request_logs.create({
    data: {
      ts:             BigInt(entry.ts),
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
    },
    select: { id: true },
  });

  totalTokensAllTime += entry.input_tokens + entry.output_tokens + (entry.cache_read || 0) + (entry.cache_creation || 0);
  allTimePerUser[uid] = (allTimePerUser[uid] || 0) + entry.input_tokens + entry.output_tokens;
  const full: RequestLogEntry = {
    id:          inserted.id,
    ...entry,
    user_id:     uid,
    owner_name:  resolveOwnerName(tk),
    token_label: resolveTokenLabel(entry.token_key, tk),
  };
  recentLogs.unshift(full);
  if (recentLogs.length > 200) recentLogs.pop();
}

export async function dbQueryLogs(page: number, limit: number, user: string): Promise<RequestLogEntry[]> {
  try {
    const offset = (page - 1) * limit;
    const rows = user
      ? await prisma.request_logs.findMany({ where: { token_key: user }, orderBy: { ts: "desc" }, skip: offset, take: limit })
      : await prisma.request_logs.findMany({ orderBy: { ts: "desc" }, skip: offset, take: limit });
    return rows.map(rowToLog);
  } catch { return []; }
}

export async function dbCountLogs(user: string): Promise<number> {
  try {
    return user
      ? await prisma.request_logs.count({ where: { token_key: user } })
      : await prisma.request_logs.count();
  } catch { return 0; }
}

export async function dbGetLog(id: number): Promise<RequestLogEntry | null> {
  try {
    const row = await prisma.request_logs.findUnique({ where: { id } });
    return row ? rowToLog(row) : null;
  } catch { return null; }
}

export async function dbClearLogs(user?: string) {
  if (user) {
    await prisma.request_logs.deleteMany({ where: { token_key: user } });
    let i = recentLogs.findIndex(l => l.token_key === user);
    while (i >= 0) { recentLogs.splice(i, 1); i = recentLogs.findIndex(l => l.token_key === user); }
  } else {
    await prisma.request_logs.deleteMany({});
    recentLogs.splice(0, recentLogs.length);
  }
}

export async function dbGetTokenKeys(): Promise<string[]> {
  try {
    const rows = await prisma.request_logs.findMany({
      select: { token_key: true },
      distinct: ["token_key"],
      orderBy: { token_key: "asc" },
    });
    return rows.map(r => r.token_key).filter(Boolean);
  } catch { return []; }
}

export async function dbGetTokenNames(): Promise<string[]> {
  try {
    const rows = await prisma.$queryRaw<{ n: string }[]>`
      SELECT DISTINCT COALESCE(NULLIF(name, ''), token_key) AS n
      FROM request_logs ORDER BY n
    `;
    return rows.map(r => r.n).filter(Boolean);
  } catch { return []; }
}

// ── Load from DB (async, called once at startup) ──────────────────────────────
export async function loadFromDb() {
  const now = Date.now();

  // Load users
  const userRows = await prisma.users.findMany({ orderBy: { name: "asc" } });
  for (const row of userRows) {
    users[row.id] = {
      id: row.id, name: row.name, email: row.email || "",
      description: row.description || "", created_at: Number(row.created_at),
      role:   (row.role   as import("./types").UserRole)   || "USER",
      status: (row.status as import("./types").UserStatus) || "pending",
      context_blocked_at:        row.context_blocked_at        ? Number(row.context_blocked_at)        : undefined,
      context_block_reason:      row.context_block_reason      ?? undefined,
      context_block_grace_until: row.context_block_grace_until ? Number(row.context_block_grace_until) : undefined,
    };
  }

  // Load tokens. Window-expiry auto-reset on boot only applies when the GLOBAL
  // reset mode is "auto" — manual/daily skip it (manual never resets on its own;
  // daily resets at midnight via checkReset, not boot).
  const tokenRows = await prisma.tokens.findMany({ where: { deleted: false } });
  const globalResetMode = (settings["reset_mode"] || "manual") as import("./types").ResetMode;
  for (const row of tokenRows) {
    const win        = Number(row.win);
    const ws         = Number(row.window_start);
    const expired    = globalResetMode === "auto" && (now - ws >= win);
    tokens[row.key] = {
      limit:        fromLim(row.lim),
      window:       win,
      used:         expired ? 0 : Number(row.used),
      windowStart:  expired ? now : ws,
      paused:       row.paused,
      dynamic:      row.dynamic,
      mode:         "inherit",
      provider:     (row.provider as import("./types").TokenProvider) || "inherit",
      user_id:      row.user_id || "",
      label:        (row as any).label || "",
      description:  (row as any).description || "",
      pinned_model: (row as any).pinned_model || "",
      allowed_models: (row as any).allowed_models ?? [],
      last_reset:   (row as any).last_reset != null ? Number((row as any).last_reset) : 0,
      output_type:  (row as any).output_type || "anthropic",
    };
    if (expired) {
      await prisma.tokens.update({ where: { key: row.key }, data: { used: BigInt(0), window_start: BigInt(now), last_reset: BigInt(now) } });
    }
  }

  // Load upstream state
  const up = await prisma.upstream_state.findUnique({ where: { id: 1 } });
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

  // Load settings
  const settingRows = await prisma.settings.findMany();
  for (const row of settingRows) settings[row.key] = row.value;
  if (settingRows.length) console.log(`Settings loaded: ${settingRows.length} key(s)`);

  // Prune old daily usage (keep 30 days) — localDateStr() pakai TZ env, bukan UTC
  const cutoff = localDateStr(new Date(now - 30 * 86400000));
  await prisma.daily_usage.deleteMany({ where: { date: { lt: cutoff } } });

  // Load daily usage
  const usageRows = await prisma.daily_usage.findMany({ where: { date: { gte: cutoff } } });
  for (const row of usageRows) {
    if (!dailyUsage[row.date]) dailyUsage[row.date] = {};
    dailyUsage[row.date][row.token_key] = row.used;
  }

  // Prune old request logs (keep 30 days)
  const logCutoff = BigInt(now - 30 * 86400000);
  await prisma.request_logs.deleteMany({ where: { ts: { lt: logCutoff } } });

  // Load recent logs (last 200)
  const logRows = await prisma.request_logs.findMany({ orderBy: { ts: "desc" }, take: 200 });
  for (const row of logRows) recentLogs.push(rowToLog(row));

  // Total tokens all time
  const totResult = await prisma.request_logs.aggregate({
    _sum: { input_tokens: true, output_tokens: true, cache_read: true, cache_creation: true },
  });
  totalTokensAllTime =
    (totResult._sum.input_tokens   ?? 0) +
    (totResult._sum.output_tokens  ?? 0) +
    (totResult._sum.cache_read     ?? 0) +
    (totResult._sum.cache_creation ?? 0);

  // All time per user
  const perUserRows = await prisma.$queryRaw<{ uid: string; total: bigint }[]>`
    SELECT COALESCE(NULLIF(user_id,''), token_key) AS uid,
           SUM(input_tokens + output_tokens) as total
    FROM request_logs GROUP BY uid
  `;
  for (const r of perUserRows) allTimePerUser[r.uid] = Number(r.total) ?? 0;

  console.log(`DB loaded: ${tokenRows.length} token(s), ${logRows.length} log(s)`);
}

// ── Backfill user_id on request_logs / daily_usage from tokens.user_id ────────
// Active tokens have user_id set; this propagates that to log/usage rows that
// pre-date the user system. Deleted tokens are skipped — without the legacy
// tokens.name mirror there's no fallback for orphan user seeding.
export async function backfillUsers() {
  for (const [key, tk] of Object.entries(tokens)) {
    const uid = tk.user_id;
    if (!uid) continue;
    await prisma.request_logs.updateMany({
      where: { token_key: key, user_id: "" },
      data: { user_id: uid },
    });
    await prisma.daily_usage.updateMany({
      where: { token_key: key, user_id: "" },
      data: { user_id: uid },
    });
  }

  // Reload allTimePerUser after backfill
  const perUserRows = await prisma.$queryRaw<{ uid: string; total: bigint }[]>`
    SELECT COALESCE(NULLIF(user_id,''), token_key) AS uid,
           SUM(input_tokens + output_tokens) as total
    FROM request_logs GROUP BY uid
  `;
  for (const r of perUserRows) allTimePerUser[r.uid] = Number(r.total) ?? 0;

  // Sync SUPER_ADMIN_EMAILS — selalu approved
  for (const u of Object.values(users)) {
    if (u.email && config.superAdminEmails.has(u.email.toLowerCase())) {
      const updates: Record<string, string> = {};
      if (u.role !== "SUPER_ADMIN") { u.role = "SUPER_ADMIN"; updates.role = "SUPER_ADMIN"; }
      if (u.status !== "approved")  { u.status = "approved";  updates.status = "approved"; }
      if (Object.keys(updates).length) await prisma.users.update({ where: { id: u.id }, data: updates });
    }
  }

  console.log(`Users backfill done: ${Object.keys(users).length} user(s)`);
}

export async function onShutdown(sig: string) {
  console.log(`Received ${sig}, closing DB...`);
  const { closeDb } = await import("./prisma");
  await closeDb();
  process.exit(0);
}
