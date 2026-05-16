import { prisma } from "../../prisma";
import { isEnabled, updateExtensionConfig, getConfig } from "../registry";
import { defaultConfig, type LogManagementConfig } from "./config";
import { pruneOldLogs } from "./prune";
import { triggerBroadcast } from "../../broadcast";

function notEnabled(): Response {
  return Response.json({ ok: false, error: "Log Management extension is not enabled" }, { status: 409 });
}

function effectiveConfig(): LogManagementConfig {
  return { ...defaultConfig, ...(getConfig("log-management") as Partial<LogManagementConfig>) };
}

export async function handleLogManagementAdmin(req: Request, url: URL): Promise<Response> {
  if (!isEnabled("log-management")) return notEnabled();
  const path = url.pathname;

  if (req.method === "GET"  && path === "/api/admin/log-management/logs")     return handleList(url);
  if (req.method === "GET"  && path === "/api/admin/log-management/stats")    return handleStats(url);
  if (req.method === "GET"  && path === "/api/admin/log-management/sources")  return handleSources();
  if (req.method === "GET"  && path === "/api/admin/log-management/settings") return Response.json({ config: effectiveConfig() });
  if (req.method === "POST" && path === "/api/admin/log-management/settings") {
    const patch = await req.json().catch(() => ({})) as any;
    const res = await updateExtensionConfig("log-management", patch);
    if (!res.ok) return Response.json(res, { status: 400 });
    triggerBroadcast();
    return Response.json({ ok: true, config: { ...defaultConfig, ...(res.config as Partial<LogManagementConfig>) } });
  }
  if (req.method === "POST" && path === "/api/admin/log-management/clear")    return handleClear(req);
  if (req.method === "POST" && path === "/api/admin/log-management/prune")    return handlePrune();

  return Response.json({ error: "Not found" }, { status: 404 });
}

// GET /api/admin/log-management/logs?level=&source=&q=&since_minutes=&limit=&offset=
async function handleList(url: URL): Promise<Response> {
  const level   = url.searchParams.get("level") || "";
  const source  = url.searchParams.get("source") || "";
  const q       = (url.searchParams.get("q") || "").trim();
  const since_m = parseInt(url.searchParams.get("since_minutes") || "0");
  const limit   = Math.min(500, Math.max(1, parseInt(url.searchParams.get("limit") || "100")));
  const offset  = Math.max(0, parseInt(url.searchParams.get("offset") || "0"));

  const where: string[] = [];
  const params: any[] = [];
  let i = 1;
  if (level)   { where.push(`level = $${i++}`);              params.push(level); }
  if (source)  { where.push(`source = $${i++}`);             params.push(source); }
  if (since_m) { where.push(`ts > $${i++}`);                 params.push(BigInt(Date.now() - since_m * 60_000)); }
  if (q)       { where.push(`message ILIKE $${i++}`);        params.push(`%${q}%`); }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const sql = `SELECT id, ts, level, source, message, context
                 FROM app_logs ${whereSql}
                ORDER BY ts DESC
                LIMIT $${i++} OFFSET $${i++}`;
  params.push(limit, offset);

  const countSql = `SELECT COUNT(*)::int AS c FROM app_logs ${whereSql}`;
  const [rows, countRows] = await Promise.all([
    prisma.$queryRawUnsafe<any[]>(sql, ...params),
    prisma.$queryRawUnsafe<any[]>(countSql, ...params.slice(0, params.length - 2)),
  ]);

  return Response.json({
    total: countRows[0]?.c ?? 0,
    limit, offset,
    logs: rows.map(r => ({
      id:      Number(r.id),
      ts:      Number(r.ts),
      age_sec: Math.round((Date.now() - Number(r.ts)) / 1000),
      level:   r.level,
      source:  r.source,
      message: r.message,
      context: r.context,
    })),
  });
}

// GET /api/admin/log-management/stats
async function handleStats(url: URL): Promise<Response> {
  const since_h = Math.min(168, Math.max(1, parseInt(url.searchParams.get("since_hours") || "24")));
  const cutoff = BigInt(Date.now() - since_h * 3600_000);

  const [byLevel, bySource, total, oldest, newest] = await Promise.all([
    prisma.$queryRawUnsafe<any[]>(
      `SELECT level, COUNT(*)::int AS c FROM app_logs WHERE ts > $1 GROUP BY level ORDER BY c DESC`,
      cutoff,
    ),
    prisma.$queryRawUnsafe<any[]>(
      `SELECT source, COUNT(*)::int AS c FROM app_logs WHERE ts > $1 GROUP BY source ORDER BY c DESC LIMIT 20`,
      cutoff,
    ),
    prisma.$queryRawUnsafe<any[]>(`SELECT COUNT(*)::int AS c FROM app_logs`),
    prisma.$queryRawUnsafe<any[]>(`SELECT MIN(ts)::bigint AS t FROM app_logs`),
    prisma.$queryRawUnsafe<any[]>(`SELECT MAX(ts)::bigint AS t FROM app_logs`),
  ]);

  return Response.json({
    window_hours:  since_h,
    total_entries: total[0]?.c ?? 0,
    oldest_ts:     oldest[0]?.t ? Number(oldest[0].t) : null,
    newest_ts:     newest[0]?.t ? Number(newest[0].t) : null,
    by_level:      byLevel.map(r => ({ level: r.level,   count: Number(r.c) })),
    by_source:     bySource.map(r => ({ source: r.source, count: Number(r.c) })),
  });
}

async function handleSources(): Promise<Response> {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT source, COUNT(*)::int AS c FROM app_logs GROUP BY source ORDER BY c DESC LIMIT 50`,
  );
  return Response.json({ sources: rows.map(r => ({ source: r.source, count: Number(r.c) })) });
}

// POST /api/admin/log-management/clear   body: { level?, source?, older_than_hours? }
async function handleClear(req: Request): Promise<Response> {
  const body = await req.json().catch(() => ({})) as any;
  const where: string[] = [];
  const params: any[] = [];
  let i = 1;
  if (body?.level)  { where.push(`level = $${i++}`);  params.push(body.level); }
  if (body?.source) { where.push(`source = $${i++}`); params.push(body.source); }
  if (body?.older_than_hours) {
    where.push(`ts < $${i++}`);
    params.push(BigInt(Date.now() - parseInt(body.older_than_hours) * 3600_000));
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const r = await prisma.$executeRawUnsafe(`DELETE FROM app_logs ${whereSql}`, ...params);
  triggerBroadcast();
  return Response.json({ ok: true, deleted: Number(r) });
}

async function handlePrune(): Promise<Response> {
  const n = await pruneOldLogs();
  triggerBroadcast();
  return Response.json({ ok: true, deleted: n });
}
