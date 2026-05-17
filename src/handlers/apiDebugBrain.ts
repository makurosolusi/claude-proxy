import { config } from "../config";
import { prisma } from "../prisma";
import { listExtensions, isEnabled, getConfig } from "../extensions/registry";
import { handleApiTest } from "./apiTest";
import { handleDeepSeekTest, handleOpenRouterTest, handleCustomProviderTest } from "./apiTestProviders";

function checkMcpSecret(req: Request): boolean {
  if (!config.mcpSecret) return false;
  const token = req.headers.get("x-mcp-secret") || req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return token === config.mcpSecret;
}

function maskApiKeys(cfg: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(cfg)) {
    if (/api_?key|secret|token|password/i.test(k) && typeof v === "string" && v) {
      out[k] = `…${v.slice(-6)} (len ${v.length})`;
    } else { out[k] = v; }
  }
  return out;
}

// GET /api/debug/extensions
export function handleDebugExtensions(req: Request): Response {
  if (!checkMcpSecret(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const list = listExtensions().map(e => ({
    id:          e.id,
    name:        e.name,
    description: e.description,
    enabled:     isEnabled(e.id),
    config:      maskApiKeys(getConfig(e.id) || {}),
  }));
  return Response.json({
    total:   list.length,
    enabled: list.filter(e => e.enabled).length,
    extensions: list,
  });
}

async function tableExists(name: string): Promise<boolean> {
  const r = await prisma.$queryRawUnsafe<any[]>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1) AS e`,
    name,
  );
  return !!r[0]?.e;
}

// GET /api/debug/brain/overview
export async function handleDebugBrainOverview(req: Request): Promise<Response> {
  if (!checkMcpSecret(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!await tableExists("sb_extension_logs")) {
    return Response.json({ error: "Second Brain tables not present — extension never enabled" }, { status: 409 });
  }
  const since = BigInt(Date.now() - 7 * 86400_000);
  const [counts, topStrategies, totalStrategies] = await Promise.all([
    prisma.$queryRawUnsafe<any[]>(
      `SELECT event_type, COUNT(*)::int AS c FROM sb_extension_logs WHERE ts > $1 GROUP BY event_type ORDER BY c DESC`,
      since,
    ),
    prisma.$queryRawUnsafe<any[]>(
      `SELECT id, title, scope, use_count, success_count, fail_count
         FROM sb_strategies ORDER BY use_count DESC LIMIT 5`,
    ),
    prisma.$queryRawUnsafe<any[]>(`SELECT COUNT(*)::int AS c FROM sb_strategies`),
  ]);
  const byType: Record<string, number> = Object.fromEntries(counts.map(r => [r.event_type, r.c]));
  return Response.json({
    extension_enabled: isEnabled("second-brain"),
    strategies: {
      total:           totalStrategies[0]?.c ?? 0,
      mined_7d:        byType.mine_completed ?? 0,
      skipped_7d:      byType.mine_skipped ?? 0,
      failed_7d:       byType.mine_failed ?? 0,
      injected_7d:     byType.strategy_injected ?? 0,
      used_success_7d: byType.strategy_used_success ?? 0,
      used_fail_7d:    byType.strategy_used_fail ?? 0,
      top: topStrategies.map(s => ({
        id: s.id, title: s.title, scope: s.scope,
        use_count: Number(s.use_count), success_count: Number(s.success_count), fail_count: Number(s.fail_count),
      })),
    },
    event_counts_7d: byType,
  });
}

// GET /api/debug/brain/strategies?limit=N&q=text
export async function handleDebugBrainStrategies(req: Request, url: URL): Promise<Response> {
  if (!checkMcpSecret(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!await tableExists("sb_strategies")) return Response.json({ error: "sb_strategies table missing" }, { status: 409 });
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get("limit") || "20")));
  const q     = (url.searchParams.get("q") || "").trim();
  let rows: any[];
  if (q) {
    const { embedText } = await import("../extensions/second-brain/embedding");
    const vec = await embedText(q);
    const lit = "[" + vec.join(",") + "]";
    rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, title, when_to_use, scope, user_id, project, use_count, success_count, fail_count,
              created_at, updated_at, 1 - (embedding <=> $1::vector) AS similarity
         FROM sb_strategies ORDER BY embedding <=> $1::vector LIMIT $2`,
      lit, limit,
    );
  } else {
    rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, title, when_to_use, scope, user_id, project, use_count, success_count, fail_count,
              created_at, updated_at
         FROM sb_strategies ORDER BY updated_at DESC LIMIT $1`,
      limit,
    );
  }
  return Response.json({
    total: rows.length, query: q || null,
    strategies: rows.map(r => ({
      id: r.id, title: r.title, when_to_use: r.when_to_use,
      scope: r.scope, user_id: r.user_id, project: r.project,
      use_count: Number(r.use_count), success_count: Number(r.success_count), fail_count: Number(r.fail_count),
      created_at: Number(r.created_at), updated_at: Number(r.updated_at),
      similarity: r.similarity != null ? Math.round(Number(r.similarity) * 1000) / 1000 : undefined,
    })),
  });
}

// GET /api/debug/brain/queue
// pg-boss schema: sb_pgboss. Tables: job (active+pending), archive (done+failed history).
export async function handleDebugBrainQueue(req: Request): Promise<Response> {
  if (!checkMcpSecret(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const schemaExists = await prisma.$queryRawUnsafe<any[]>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'sb_pgboss') AS e`,
  );
  if (!schemaExists[0]?.e) return Response.json({ error: "sb_pgboss schema missing — worker never started" }, { status: 409 });
  const [jobCounts, archiveStats, oldest] = await Promise.all([
    prisma.$queryRawUnsafe<any[]>(
      `SELECT name, state, COUNT(*)::int AS c FROM sb_pgboss.job GROUP BY name, state ORDER BY name, state`,
    ).catch(() => [] as any[]),
    prisma.$queryRawUnsafe<any[]>(
      `SELECT name, state, COUNT(*)::int AS c
         FROM sb_pgboss.archive
        WHERE completedon > NOW() - INTERVAL '24 hours'
        GROUP BY name, state ORDER BY c DESC`,
    ).catch(() => [] as any[]),
    prisma.$queryRawUnsafe<any[]>(
      `SELECT name, state, EXTRACT(EPOCH FROM (NOW() - createdon))::int AS age_sec
         FROM sb_pgboss.job WHERE state IN ('created','retry','active')
         ORDER BY createdon ASC LIMIT 5`,
    ).catch(() => [] as any[]),
  ]);
  return Response.json({
    schema: "sb_pgboss",
    active_jobs: jobCounts.map(r => ({ name: r.name, state: r.state, count: Number(r.c) })),
    archive_24h: archiveStats.map(r => ({ name: r.name, state: r.state, count: Number(r.c) })),
    oldest_pending: oldest.map(r => ({ name: r.name, state: r.state, age_sec: Number(r.age_sec) })),
  });
}

// GET /api/debug/db-size
// Top tables by total size + estimated row counts.
export async function handleDebugDbSize(req: Request): Promise<Response> {
  if (!checkMcpSecret(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const tables = await prisma.$queryRawUnsafe<any[]>(
    `SELECT schemaname, relname AS table_name,
            pg_total_relation_size(schemaname||'.'||relname) AS bytes,
            pg_size_pretty(pg_total_relation_size(schemaname||'.'||relname)) AS size,
            n_live_tup AS row_estimate
       FROM pg_stat_user_tables
      ORDER BY pg_total_relation_size(schemaname||'.'||relname) DESC
      LIMIT 25`,
  );
  const dbSize = await prisma.$queryRawUnsafe<any[]>(
    `SELECT pg_size_pretty(pg_database_size(current_database())) AS size,
            pg_database_size(current_database())::bigint AS bytes`,
  );
  return Response.json({
    database_size:  dbSize[0]?.size,
    database_bytes: Number(dbSize[0]?.bytes ?? 0),
    tables: tables.map(t => ({
      schema: t.schemaname, table: t.table_name,
      size:   t.size, bytes: Number(t.bytes),
      rows:   Number(t.row_estimate),
    })),
  });
}

// GET /api/debug/sessions-summary
export async function handleDebugSessionsSummary(req: Request): Promise<Response> {
  if (!checkMcpSecret(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { handleApiSessionsSummary } = await import("./apiSessions");
  return handleApiSessionsSummary();
}

// GET /api/debug/test-upstream/:provider — probe upstream connectivity
export async function handleDebugTestUpstream(req: Request, url: URL): Promise<Response> {
  if (!checkMcpSecret(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const m = url.pathname.match(/^\/api\/debug\/test-upstream\/([a-z][a-z0-9-]*)$/);
  if (!m) return Response.json({ error: "Provider required: anthropic|deepseek|openrouter|<custom-id>" }, { status: 400 });
  const provider = m[1]!;
  if (provider === "anthropic") return handleApiTest();
  if (provider === "deepseek")  return handleDeepSeekTest();
  if (provider === "openrouter") return handleOpenRouterTest();
  return handleCustomProviderTest(provider);
}

// GET /api/debug/app-logs?level=&source=&q=&since_minutes=&limit=
// Read from app_logs table (log-management extension). Returns 409 if extension
// never enabled (table missing). Filters mirror the admin list endpoint.
export async function handleDebugAppLogs(req: Request, url: URL): Promise<Response> {
  if (!checkMcpSecret(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!await tableExists("app_logs")) {
    return Response.json({ error: "app_logs table missing — log-management extension never enabled" }, { status: 409 });
  }
  const level   = url.searchParams.get("level") || "";
  const source  = url.searchParams.get("source") || "";
  const q       = (url.searchParams.get("q") || "").trim();
  const since_m = parseInt(url.searchParams.get("since_minutes") || "0");
  const limit   = Math.min(500, Math.max(1, parseInt(url.searchParams.get("limit") || "100")));

  const where: string[] = [];
  const params: any[] = [];
  let i = 1;
  if (level)   { where.push(`level = $${i++}`);       params.push(level); }
  if (source)  { where.push(`source = $${i++}`);      params.push(source); }
  if (since_m) { where.push(`ts > $${i++}`);          params.push(BigInt(Date.now() - since_m * 60_000)); }
  if (q)       { where.push(`message ILIKE $${i++}`); params.push(`%${q}%`); }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id, ts, level, source, message FROM app_logs ${whereSql} ORDER BY ts DESC LIMIT $${i++}`,
    ...params, limit,
  );
  const now = Date.now();
  return Response.json({
    total: rows.length,
    logs:  rows.map(r => ({
      id:      Number(r.id),
      ts:      Number(r.ts),
      age_sec: Math.round((now - Number(r.ts)) / 1000),
      level:   r.level,
      source:  r.source,
      message: r.message,
    })),
  });
}

// GET /api/debug/app-logs/stats?since_hours=N
export async function handleDebugAppLogsStats(req: Request, url: URL): Promise<Response> {
  if (!checkMcpSecret(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!await tableExists("app_logs")) {
    return Response.json({ error: "app_logs table missing — log-management extension never enabled" }, { status: 409 });
  }
  const since_h = Math.min(168, Math.max(1, parseInt(url.searchParams.get("since_hours") || "24")));
  const cutoff = BigInt(Date.now() - since_h * 3600_000);
  const [byLevel, bySource, total, oldest] = await Promise.all([
    prisma.$queryRawUnsafe<any[]>(`SELECT level, COUNT(*)::int AS c FROM app_logs WHERE ts > $1 GROUP BY level ORDER BY c DESC`, cutoff),
    prisma.$queryRawUnsafe<any[]>(`SELECT source, COUNT(*)::int AS c FROM app_logs WHERE ts > $1 GROUP BY source ORDER BY c DESC LIMIT 20`, cutoff),
    prisma.$queryRawUnsafe<any[]>(`SELECT COUNT(*)::int AS c FROM app_logs`),
    prisma.$queryRawUnsafe<any[]>(`SELECT MIN(ts)::bigint AS t FROM app_logs`),
  ]);
  return Response.json({
    window_hours:  since_h,
    total_entries: total[0]?.c ?? 0,
    oldest_ts:     oldest[0]?.t ? Number(oldest[0].t) : null,
    by_level:      byLevel.map(r => ({ level: r.level, count: Number(r.c) })),
    by_source:     bySource.map(r => ({ source: r.source, count: Number(r.c) })),
  });
}

// GET /api/debug/active-providers?minutes=N
// Recent request distribution by provider/model/status.
export async function handleDebugActiveProviders(req: Request, url: URL): Promise<Response> {
  if (!checkMcpSecret(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const minutes = Math.min(1440, Math.max(1, parseInt(url.searchParams.get("minutes") || "60")));
  const since = BigInt(Date.now() - minutes * 60_000);
  const [byModel, byStatus, totals] = await Promise.all([
    prisma.$queryRawUnsafe<any[]>(
      `SELECT model, COUNT(*)::int AS requests,
              SUM(input_tokens)::bigint AS input_tokens,
              SUM(output_tokens)::bigint AS output_tokens,
              AVG(duration_ms)::int AS avg_ms
         FROM request_logs WHERE ts > $1
         GROUP BY model ORDER BY requests DESC LIMIT 15`,
      since,
    ),
    prisma.$queryRawUnsafe<any[]>(
      `SELECT status, COUNT(*)::int AS c FROM request_logs WHERE ts > $1
         GROUP BY status ORDER BY c DESC`,
      since,
    ),
    prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status >= 400)::int AS errors,
              COUNT(*) FILTER (WHERE stream = true)::int AS streamed
         FROM request_logs WHERE ts > $1`,
      since,
    ),
  ]);
  return Response.json({
    window_minutes: minutes,
    totals: {
      requests:  totals[0]?.total ?? 0,
      errors:    totals[0]?.errors ?? 0,
      streamed:  totals[0]?.streamed ?? 0,
      error_pct: totals[0]?.total > 0 ? Math.round((totals[0].errors / totals[0].total) * 100) : 0,
    },
    by_model: byModel.map(r => ({
      model: r.model, requests: Number(r.requests),
      input_tokens:  Number(r.input_tokens || 0),
      output_tokens: Number(r.output_tokens || 0),
      avg_duration_ms: Number(r.avg_ms || 0),
    })),
    by_status: byStatus.map(r => ({ status: Number(r.status), count: Number(r.c) })),
  });
}
