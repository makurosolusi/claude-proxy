import { config }     from "../config";
import { db, tokens, upstream, dailyUsage } from "../state";
import { getInFlight } from "../tokens";

function checkMcpSecret(req: Request): boolean {
  if (!config.mcpSecret) return false;
  const token = req.headers.get("x-mcp-secret") || req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return token === config.mcpSecret;
}

// GET /api/debug/token/:key  — detail satu token + 7-day usage + recent logs
export function handleDebugToken(req: Request, url: URL): Response {
  if (!checkMcpSecret(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parts = url.pathname.split("/").filter(Boolean);
  const keyFragment = parts[parts.length - 1] ?? "";

  // Match by full key or last N chars
  const entry = Object.entries(tokens).find(([k]) =>
    k === keyFragment || k.endsWith(keyFragment)
  );
  if (!entry) return Response.json({ error: "Token not found" }, { status: 404 });

  const [key, tk] = entry;
  const inFlight  = getInFlight(key);

  // Last 7 days usage from daily_usage
  const cutoff = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const dailyRows = db.query(
    "SELECT date, used FROM daily_usage WHERE token_key=? AND date>=? ORDER BY date DESC"
  ).all(key, cutoff) as { date: string; used: number }[];

  // Last 20 requests
  const logRows = db.query(
    "SELECT id, ts, model, input_tokens, output_tokens, status, stop_reason, duration_ms, prompt FROM request_logs WHERE token_key=? ORDER BY ts DESC LIMIT 20"
  ).all(key) as any[];

  return Response.json({
    key_suffix: key.slice(-8),
    name:       tk.name,
    user_id:    tk.user_id,
    provider:   tk.provider,
    paused:     tk.paused,
    used:       tk.used,
    limit:      tk.limit === Infinity ? null : tk.limit,
    remaining:  tk.limit === Infinity ? null : Math.max(0, tk.limit - tk.used),
    pct:        tk.limit === Infinity ? 0 : Math.round((tk.used / tk.limit) * 100),
    in_flight:  inFlight,
    window_ms:  tk.window,
    window_start: tk.windowStart,
    daily_usage: dailyRows,
    recent_logs: logRows.map(l => ({
      id:           l.id,
      ts:           l.ts,
      age_sec:      Math.round((Date.now() - l.ts) / 1000),
      model:        l.model,
      input_tokens: l.input_tokens,
      output_tokens:l.output_tokens,
      status:       l.status,
      stop_reason:  l.stop_reason,
      duration_ms:  l.duration_ms,
      prompt:       (l.prompt || "").slice(0, 120),
    })),
  });
}

// GET /api/debug/upstream-history  — state upstream saat ini + recent errors dari logs
export function handleDebugUpstreamHistory(req: Request): Response {
  if (!checkMcpSecret(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const upRow = db.query("SELECT * FROM upstream_state WHERE id=1").get() as any;

  // Proxy errors (429/502/503) dari 24 jam terakhir sebagai proxy upstream issue history
  const since = Date.now() - 24 * 3600000;
  const errorRows = db.query(
    "SELECT ts, status, model, name, duration_ms FROM request_logs WHERE ts>? AND status>=400 ORDER BY ts DESC LIMIT 50"
  ).all(since) as any[];

  // Hourly error distribution
  const hourlyErrors = db.query(`
    SELECT strftime('%H', datetime(ts/1000, 'unixepoch', 'localtime')) as hour,
           status, count(*) as count
    FROM request_logs
    WHERE ts > ? AND status >= 400
    GROUP BY hour, status
    ORDER BY hour DESC
  `).all(since) as any[];

  return Response.json({
    current_state: {
      last_poll:         upRow?.last_poll ?? null,
      poll_age_sec:      upRow?.last_poll ? Math.round((Date.now() - upRow.last_poll) / 1000) : null,
      five_hour_util:    upRow?.five_hour_util ?? null,
      five_hour_resets:  upRow?.five_hour_resets_at ?? null,
      seven_day_util:    upRow?.seven_day_util ?? null,
      seven_day_resets:  upRow?.seven_day_resets_at ?? null,
      sonnet_util:       upRow?.sonnet_util ?? null,
      opus_util:         upRow?.opus_util ?? null,
      detected_window_ms: upRow?.detected_window_ms ?? null,
    },
    runtime: {
      last_poll_ok:    upstream.lastPollOk,
      last_error:      upstream.lastError,
      backoff_until:   upstream.pollBackoffUntil,
      backoff_active:  upstream.pollBackoffUntil > Date.now(),
      fallback_active: upstream.fallbackActive,
      fallback_provider: upstream.fallbackProvider,
    },
    proxy_errors_24h: {
      total: errorRows.length,
      hourly_distribution: hourlyErrors,
      recent: errorRows.slice(0, 20).map(l => ({
        ts:         l.ts,
        age_sec:    Math.round((Date.now() - l.ts) / 1000),
        status:     l.status,
        model:      l.model,
        name:       l.name,
        duration_ms: l.duration_ms,
      })),
    },
  });
}

// GET /api/debug/quota-pressure  — in-flight per token + quota headroom
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
        key_suffix:  key.slice(-8),
        name:        tk.name,
        used,
        limit,
        remaining,
        in_flight:   inFlight,
        headroom,
        pct_used:    limit ? Math.round((used / limit) * 100) : 0,
        pct_pressure: limit ? Math.round(((used + inFlight) / limit) * 100) : 0,
        at_risk:     headroom !== null && headroom < 5000,
      };
    })
    .sort((a, b) => (b.pct_pressure ?? 0) - (a.pct_pressure ?? 0));

  const atRisk    = snapshot.filter(t => t.at_risk);
  const totalUsed = snapshot.reduce((s, t) => s + t.used, 0);
  const totalInFlight = snapshot.reduce((s, t) => s + t.in_flight, 0);

  return Response.json({
    summary: {
      total_tokens:   snapshot.length,
      at_risk_count:  atRisk.length,
      total_used:     totalUsed,
      total_in_flight: totalInFlight,
    },
    at_risk: atRisk,
    tokens: snapshot,
  });
}
