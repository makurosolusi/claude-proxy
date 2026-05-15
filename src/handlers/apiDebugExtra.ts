import { config }  from "../config";
import { prisma }  from "../prisma";
import { tokens, users, upstream, recentLogs, settings, allTimePerUser, dailyUsage, resolveTokenName } from "../state";
import { getInFlight } from "../tokens";
import { readConsole, getErrorStats, type LogLevel } from "../consoleBuffer";
import { listSyncTokens } from "./apiDbSync";

function checkMcpSecret(req: Request): boolean {
  if (!config.mcpSecret) return false;
  const token = req.headers.get("x-mcp-secret") || req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return token === config.mcpSecret;
}

// GET /api/debug/token/:key
export async function handleDebugToken(req: Request, url: URL): Promise<Response> {
  if (!checkMcpSecret(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parts = url.pathname.split("/").filter(Boolean);
  const keyFragment = parts[parts.length - 1] ?? "";

  const entry = Object.entries(tokens).find(([k]) => k === keyFragment || k.endsWith(keyFragment));
  if (!entry) return Response.json({ error: "Token not found" }, { status: 404 });

  const [key, tk] = entry;
  const inFlight  = getInFlight(key);

  const cutoff    = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const dailyRows = await prisma.daily_usage.findMany({
    where: { token_key: key, date: { gte: cutoff } },
    select: { date: true, used: true },
    orderBy: { date: "desc" },
  });

  const logRows = await prisma.request_logs.findMany({
    where: { token_key: key },
    select: { id: true, ts: true, model: true, input_tokens: true, output_tokens: true, status: true, stop_reason: true, duration_ms: true, prompt: true },
    orderBy: { ts: "desc" },
    take: 20,
  });

  return Response.json({
    key_suffix:   key.slice(-8),
    name:         resolveTokenName(key, tk),
    user_id:      tk.user_id,
    provider:     tk.provider,
    paused:       tk.paused,
    used:         tk.used,
    limit:        tk.limit === Infinity ? null : tk.limit,
    remaining:    tk.limit === Infinity ? null : Math.max(0, tk.limit - tk.used),
    pct:          tk.limit === Infinity ? 0 : Math.round((tk.used / tk.limit) * 100),
    in_flight:    inFlight,
    window_ms:    tk.window,
    window_start: tk.windowStart,
    daily_usage:  dailyRows,
    recent_logs:  logRows.map(l => ({
      id:            l.id,
      ts:            Number(l.ts),
      age_sec:       Math.round((Date.now() - Number(l.ts)) / 1000),
      model:         l.model,
      input_tokens:  l.input_tokens,
      output_tokens: l.output_tokens,
      status:        l.status,
      stop_reason:   l.stop_reason,
      duration_ms:   l.duration_ms,
      prompt:        (l.prompt || "").slice(0, 120),
    })),
  });
}

// GET /api/debug/upstream-history
export async function handleDebugUpstreamHistory(req: Request): Promise<Response> {
  if (!checkMcpSecret(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const upRow  = await prisma.upstream_state.findUnique({ where: { id: 1 } });
  const since  = BigInt(Date.now() - 24 * 3600000);

  const errorRows = await prisma.request_logs.findMany({
    where: { ts: { gte: since }, status: { gte: 400 } },
    select: { ts: true, status: true, model: true, name: true, duration_ms: true },
    orderBy: { ts: "desc" },
    take: 50,
  });

  const hourlyErrors = await prisma.$queryRaw<{ hour: number; status: number; count: bigint }[]>`
    SELECT EXTRACT(HOUR FROM to_timestamp(ts / 1000.0))::INTEGER AS hour,
           status, COUNT(*) AS count
    FROM request_logs
    WHERE ts > ${since} AND status >= 400
    GROUP BY hour, status
    ORDER BY hour DESC
  `;

  return Response.json({
    current_state: {
      last_poll:          upRow?.last_poll ? Number(upRow.last_poll) : null,
      poll_age_sec:       upRow?.last_poll ? Math.round((Date.now() - Number(upRow.last_poll)) / 1000) : null,
      five_hour_util:     upRow?.five_hour_util ?? null,
      five_hour_resets:   upRow?.five_hour_resets_at ?? null,
      seven_day_util:     upRow?.seven_day_util ?? null,
      seven_day_resets:   upRow?.seven_day_resets_at ?? null,
      sonnet_util:        upRow?.sonnet_util ?? null,
      opus_util:          upRow?.opus_util ?? null,
      detected_window_ms: upRow?.detected_window_ms ? Number(upRow.detected_window_ms) : null,
    },
    runtime: {
      last_poll_ok:      upstream.lastPollOk,
      last_error:        upstream.lastError,
      backoff_until:     upstream.pollBackoffUntil,
      backoff_active:    upstream.pollBackoffUntil > Date.now(),
      fallback_active:   upstream.fallbackActive,
      fallback_provider: upstream.fallbackProvider,
    },
    proxy_errors_24h: {
      total: errorRows.length,
      hourly_distribution: hourlyErrors.map(r => ({ hour: Number(r.hour), status: Number(r.status), count: Number(r.count) })),
      recent: errorRows.slice(0, 20).map(l => ({
        ts:          Number(l.ts),
        age_sec:     Math.round((Date.now() - Number(l.ts)) / 1000),
        status:      l.status,
        model:       l.model,
        name:        l.name,
        duration_ms: l.duration_ms,
      })),
    },
  });
}

// GET /api/debug/quota-pressure
export function handleDebugQuotaPressure(req: Request): Response {
  if (!checkMcpSecret(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const snapshot = Object.entries(tokens)
    .filter(([, tk]) => !tk.paused)
    .map(([key, tk]) => {
      const inFlight  = getInFlight(key);
      const used      = tk.used;
      const limit     = tk.limit === Infinity ? null : tk.limit;
      const remaining = limit === null ? null : Math.max(0, limit - used);
      const headroom  = limit === null ? null : Math.max(0, limit - used - inFlight);
      return {
        key_suffix:   key.slice(-8),
        name:         resolveTokenName(key, tk),
        used, limit, remaining,
        in_flight:    inFlight,
        headroom,
        pct_used:     limit ? Math.round((used / limit) * 100) : 0,
        pct_pressure: limit ? Math.round(((used + inFlight) / limit) * 100) : 0,
        at_risk:      headroom !== null && headroom < 5000,
      };
    })
    .sort((a, b) => (b.pct_pressure ?? 0) - (a.pct_pressure ?? 0));

  const atRisk        = snapshot.filter(t => t.at_risk);
  const totalUsed     = snapshot.reduce((s, t) => s + t.used, 0);
  const totalInFlight = snapshot.reduce((s, t) => s + t.in_flight, 0);

  return Response.json({
    summary: { total_tokens: snapshot.length, at_risk_count: atRisk.length, total_used: totalUsed, total_in_flight: totalInFlight },
    at_risk: atRisk,
    tokens:  snapshot,
  });
}

// GET /api/debug/console?lines=N&level=info|warn|error&since_minutes=N
// Read in-memory ring buffer of recent stdout/stderr from the running app.
export function handleDebugConsole(req: Request, url: URL): Response {
  if (!checkMcpSecret(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const lines = Math.min(500, Math.max(1, parseInt(url.searchParams.get("lines") || "100")));
  const levelParam = url.searchParams.get("level");
  const sinceMinutes = parseInt(url.searchParams.get("since_minutes") || "0");
  const validLevel: LogLevel | undefined = (levelParam === "info" || levelParam === "warn" || levelParam === "error") ? levelParam : undefined;
  const since_ms = sinceMinutes > 0 ? Date.now() - sinceMinutes * 60_000 : undefined;
  const out = readConsole({ lines, level: validLevel, since_ms });
  return Response.json({
    total:        out.length,
    error_stats:  getErrorStats(),
    lines:        out.map(l => ({ ts: l.ts, age_sec: Math.round((Date.now() - l.ts) / 1000), level: l.level, msg: l.msg })),
  });
}

// GET /api/debug/runtime
// Process state snapshot: memory, uptime, in-memory state sizes, error counters.
export function handleDebugRuntime(req: Request): Response {
  if (!checkMcpSecret(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const mem = process.memoryUsage();
  const mb = (n: number) => Math.round(n / 1024 / 1024 * 10) / 10;
  // in-flight reservation count — sum across all tokens
  let inFlightTotal = 0;
  for (const k of Object.keys(tokens)) inFlightTotal += getInFlight(k);
  return Response.json({
    uptime_sec: Math.round(process.uptime()),
    pid:        process.pid,
    bun_version: typeof Bun !== "undefined" ? Bun.version : null,
    memory_mb: {
      rss:         mb(mem.rss),
      heap_used:   mb(mem.heapUsed),
      heap_total:  mb(mem.heapTotal),
      external:    mb(mem.external),
    },
    in_memory: {
      tokens:        Object.keys(tokens).length,
      users:         Object.keys(users).length,
      recent_logs:   recentLogs.length,
      settings_keys: Object.keys(settings).length,
      sync_tokens:   listSyncTokens().length,
      in_flight:     inFlightTotal,
    },
    upstream: {
      last_poll_ok:    upstream.lastPollOk,
      last_error:      upstream.lastError,
      backoff_active:  upstream.pollBackoffUntil > Date.now(),
      fallback_active: upstream.fallbackActive,
    },
    error_counters: getErrorStats(),
  });
}

// GET /api/debug/users
// User summary with token counts and total usage. Faster than query_db with JOIN.
export function handleDebugUsers(req: Request): Response {
  if (!checkMcpSecret(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const today = new Date().toISOString().slice(0, 10);
  const todayUsage = dailyUsage[today] || {};
  const userList = Object.values(users).map(u => {
    const userTokens = Object.entries(tokens).filter(([, tk]) => tk.user_id === u.id);
    const todayTotal = userTokens.reduce((s, [k]) => s + (todayUsage[k] || 0), 0);
    return {
      id:           u.id,
      name:         u.name,
      email:        u.email,
      role:         u.role,
      status:       u.status,
      token_count:  userTokens.length,
      alltime:      allTimePerUser[u.id] || 0,
      today:        todayTotal,
      created_at:   u.created_at,
    };
  }).sort((a, b) => b.alltime - a.alltime);

  // Orphan tokens (user_id not in users map)
  const orphans = Object.entries(tokens)
    .filter(([, tk]) => !tk.user_id || !users[tk.user_id])
    .map(([k, tk]) => ({ key_suffix: k.slice(-8), user_id: tk.user_id || "(empty)", label: tk.label || "" }));

  return Response.json({
    total_users:   userList.length,
    total_tokens:  Object.keys(tokens).length,
    orphan_tokens: orphans.length,
    users:         userList,
    orphans,
  });
}

// GET /api/debug/settings
// Runtime config dump with sensitive values masked (API keys, sync tokens).
export function handleDebugSettings(req: Request): Response {
  if (!checkMcpSecret(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const mask = (v: string) => v ? `…${v.slice(-6)} (len ${v.length})` : "(empty)";
  const out: Record<string, unknown> = {};

  for (const [k, v] of Object.entries(settings)) {
    if (/api_key|secret|password/i.test(k)) {
      out[k] = mask(v);
    } else if (k === "custom_providers") {
      try {
        const arr = JSON.parse(v);
        out[k] = Array.isArray(arr) ? arr.map((p: any) => ({ ...p, api_key: mask(p.api_key || "") })) : v;
      } catch { out[k] = "(invalid JSON)"; }
    } else if (k === "sync_tokens_v1") {
      try {
        const arr = JSON.parse(v);
        out[k] = Array.isArray(arr) ? `${arr.length} sync token(s)` : "(invalid)";
      } catch { out[k] = "(invalid JSON)"; }
    } else {
      out[k] = v;
    }
  }

  return Response.json({
    total_keys:    Object.keys(settings).length,
    settings:      out,
    env_overrides: {
      deepseek_api_key_env:   !!config.deepseekApiKey,
      openrouter_api_key_env: !!config.openrouterApiKey,
      anthropic_url:          config.anthropicUrl,
      cap_pct:                config.capPct,
    },
  });
}

// GET /api/debug/proxy-errors?minutes=60
// Group recent proxy errors (status >= 400) by status + message pattern.
// Helps spot recurring failure modes (e.g. "invalid thinking signature").
export async function handleDebugProxyErrors(req: Request, url: URL): Promise<Response> {
  if (!checkMcpSecret(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const minutes = Math.min(1440, Math.max(1, parseInt(url.searchParams.get("minutes") || "60")));
  const cutoff = BigInt(Date.now() - minutes * 60_000);

  const rows = await prisma.request_logs.findMany({
    where: { ts: { gte: cutoff }, status: { gte: 400 } },
    select: { id: true, ts: true, status: true, model: true, name: true, response_text: true, token_key: true },
    orderBy: { ts: "desc" },
    take: 500,
  });

  // Group by (status, first 80 chars of response_text)
  const groups = new Map<string, { status: number; pattern: string; count: number; last_ts: number; samples: { id: number; ts: number; model: string; name: string; token_key_suffix: string }[] }>();
  for (const r of rows) {
    const pattern = (r.response_text || "").slice(0, 80) || "(empty)";
    const key = `${r.status}|${pattern}`;
    if (!groups.has(key)) groups.set(key, { status: r.status, pattern, count: 0, last_ts: 0, samples: [] });
    const g = groups.get(key)!;
    g.count++;
    g.last_ts = Math.max(g.last_ts, Number(r.ts));
    if (g.samples.length < 3) {
      g.samples.push({ id: r.id, ts: Number(r.ts), model: r.model, name: r.name, token_key_suffix: r.token_key.slice(-8) });
    }
  }

  const grouped = [...groups.values()].sort((a, b) => b.count - a.count);
  return Response.json({
    window_minutes: minutes,
    total_errors:   rows.length,
    unique_patterns: grouped.length,
    groups: grouped.map(g => ({
      status:  g.status,
      pattern: g.pattern,
      count:   g.count,
      last_ts: g.last_ts,
      last_age_sec: Math.round((Date.now() - g.last_ts) / 1000),
      samples: g.samples,
    })),
  });
}

// GET /api/debug/sync-tokens
// List active sync tokens (used by /api/admin/db/sync) — created_at + age.
export function handleDebugSyncTokens(req: Request): Response {
  if (!checkMcpSecret(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const now = Date.now();
  const list = listSyncTokens().map(t => ({
    token:        t.token,
    created_at:   new Date(t.created_at).toISOString(),
    age_minutes:  Math.round((now - t.created_at) / 60_000),
  })).sort((a, b) => b.age_minutes - a.age_minutes);
  return Response.json({ total: list.length, tokens: list });
}

// GET /api/debug/credits/:provider — proxies the admin credits endpoint
// but with x-mcp-secret auth instead of admin session.
export async function handleDebugCredits(req: Request, url: URL): Promise<Response> {
  if (!checkMcpSecret(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const m = url.pathname.match(/^\/api\/debug\/credits\/([a-z][a-z0-9-]*)$/);
  if (!m) return Response.json({ error: "Bad provider id" }, { status: 400 });
  const provider = m[1]!;
  const { handleApiCredits } = await import("./apiCredits");
  // Reuse the existing credits handler — its check is done internally
  const rewritten = new Request(url.toString().replace("/api/debug/credits/", "/api/admin/credits/"), req);
  return handleApiCredits(rewritten, new URL(rewritten.url));
}
