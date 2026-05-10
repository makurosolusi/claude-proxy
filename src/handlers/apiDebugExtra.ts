import { config }  from "../config";
import { prisma }  from "../prisma";
import { tokens, upstream } from "../state";
import { getInFlight } from "../tokens";

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
    name:         tk.name,
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
        name:         tk.name,
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
