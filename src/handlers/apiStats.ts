import { prisma } from "../prisma";
import { tokens, resolveTokenName, deriveNameFromKey } from "../state";
import { localDateStr } from "../date";

async function buildKeyToName(): Promise<Map<string, string>> {
  const map  = new Map<string, string>();
  const rows = await prisma.$queryRaw<{ key: string; label: string; user_id: string; user_name: string | null }[]>`
    SELECT t.key, t.label, t.user_id, u.name as user_name
    FROM tokens t LEFT JOIN users u ON t.user_id = u.id
  `;
  for (const r of rows) {
    map.set(r.key, r.user_name || r.label || deriveNameFromKey(r.key));
  }
  return map;
}

function keyToNameFn(map: Map<string, string>, key: string): string {
  return map.get(key) ?? resolveTokenName(key, tokens[key]) ?? deriveNameFromKey(key);
}

export async function handleApiStats(): Promise<Response> {
  try {
    const cutoff   = localDateStr(new Date(Date.now() - 30 * 86400000));
    const cutoffMs = BigInt(Date.now() - 30 * 86400000);
    const nameMap  = await buildKeyToName();

    // Daily token usage per user
    const dailyRows = await prisma.daily_usage.findMany({
      where: { date: { gte: cutoff } },
      orderBy: { date: "asc" },
    });
    const dailyMap: Record<string, Record<string, number>> = {};
    const userSet = new Set<string>();
    for (const r of dailyRows) {
      const name = keyToNameFn(nameMap, r.token_key);
      if (!dailyMap[r.date]) dailyMap[r.date] = {};
      dailyMap[r.date][name] = (dailyMap[r.date][name] || 0) + r.used;
      userSet.add(name);
    }
    const daily = Object.entries(dailyMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, by_user]) => ({ date, total: Object.values(by_user).reduce((s, v) => s + v, 0), by_user }));

    // Requests per day + avg latency — PostgreSQL date extraction
    const reqDayRows = await prisma.$queryRaw<any[]>`
      SELECT to_char(to_timestamp(ts / 1000.0), 'YYYY-MM-DD') AS day,
             COUNT(*) AS count,
             AVG(duration_ms) AS avg_lat,
             SUM(cache_read) AS cache_r,
             SUM(cache_creation) AS cache_c,
             SUM(input_tokens + output_tokens) AS tokens
      FROM request_logs
      WHERE ts >= ${cutoffMs}
      GROUP BY day ORDER BY day ASC
    `;

    // Stop reasons
    const stopRows = await prisma.request_logs.groupBy({
      by: ["stop_reason"],
      where: { stop_reason: { not: "" } },
      _count: true,
      orderBy: { _count: { stop_reason: "desc" } },
    });

    // Per-user stats (last 30 days)
    const userRows = await prisma.$queryRaw<any[]>`
      SELECT token_key,
             COUNT(*) AS requests,
             SUM(input_tokens) AS inp,
             SUM(output_tokens) AS out,
             SUM(cache_read) AS cache_r,
             SUM(tool_use_count) AS tools,
             AVG(duration_ms) AS avg_lat,
             AVG(turns) AS avg_turns
      FROM request_logs WHERE ts >= ${cutoffMs}
      GROUP BY token_key ORDER BY requests DESC
    `;

    // Hourly distribution
    const hourRows = await prisma.$queryRaw<{ hour: number; count: bigint }[]>`
      SELECT EXTRACT(HOUR FROM to_timestamp(ts / 1000.0))::INTEGER AS hour,
             COUNT(*) AS count
      FROM request_logs GROUP BY hour ORDER BY hour ASC
    `;

    // Cache summary
    const cacheRow = await prisma.request_logs.aggregate({
      where: { ts: { gte: cutoffMs } },
      _sum: { input_tokens: true, cache_read: true, cache_creation: true },
    });

    return Response.json({
      daily,
      users: [...userSet],
      requests_by_day: reqDayRows.map((r: any) => ({
        date: r.day, count: Number(r.count),
        avg_latency: Math.round(Number(r.avg_lat) || 0),
        cache_read: Number(r.cache_r) || 0,
        tokens: Number(r.tokens) || 0,
      })),
      stop_reasons: stopRows.map(r => ({ reason: r.stop_reason || "unknown", count: r._count })),
      per_user: userRows.map((r: any) => ({
        user: keyToNameFn(nameMap, r.token_key),
        requests: Number(r.requests),
        input_tokens:  Number(r.inp) || 0,
        output_tokens: Number(r.out) || 0,
        cache_read:    Number(r.cache_r) || 0,
        tools:         Number(r.tools) || 0,
        avg_latency:   Math.round(Number(r.avg_lat) || 0),
        avg_turns:     Math.round(Number(r.avg_turns) || 0),
      })),
      hourly: Array.from({ length: 24 }, (_, i) => {
        const row = hourRows.find((r: any) => Number(r.hour) === i);
        return { hour: i, count: row ? Number(row.count) : 0 };
      }),
      cache_summary: {
        total_input:    cacheRow._sum.input_tokens    ?? 0,
        cache_read:     cacheRow._sum.cache_read      ?? 0,
        cache_creation: cacheRow._sum.cache_creation  ?? 0,
        grand_total:    (cacheRow._sum.input_tokens ?? 0) + (cacheRow._sum.cache_read ?? 0) + (cacheRow._sum.cache_creation ?? 0),
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return Response.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
