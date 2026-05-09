import { sql } from "drizzle-orm";
import { db } from "../db";
import { tokens, users, resolveTokenName, deriveNameFromKey } from "../state";

async function buildKeyToName(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const rows = await db.execute(sql`
    SELECT t.key, t.name, t.user_id, u.name as user_name
    FROM tokens t LEFT JOIN users u ON t.user_id = u.id
  `);
  for (const r of (rows as any).rows ?? []) {
    const name = r.user_name || r.name || deriveNameFromKey(r.key);
    map.set(r.key, name);
  }
  return map;
}

function keyToNameFn(map: Map<string, string>, key: string): string {
  return map.get(key) ?? resolveTokenName(key, tokens[key]) ?? deriveNameFromKey(key);
}

export async function handleApiStats(): Promise<Response> {
  try {
    const cutoff    = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const cutoffMs  = Date.now() - 30 * 86400000;
    const nameMap   = await buildKeyToName();

    // Daily token usage per user
    const dailyRows = await db.execute(sql`
      SELECT date, token_key, used FROM daily_usage WHERE date >= ${cutoff} ORDER BY date ASC
    `);

    const dailyMap: Record<string, Record<string, number>> = {};
    const userSet = new Set<string>();
    for (const r of (dailyRows as any).rows ?? []) {
      const name = keyToNameFn(nameMap, r.token_key);
      if (!dailyMap[r.date]) dailyMap[r.date] = {};
      dailyMap[r.date][name] = (dailyMap[r.date][name] || 0) + Number(r.used);
      userSet.add(name);
    }
    const daily = Object.entries(dailyMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, by_user]) => ({
        date,
        total: Object.values(by_user).reduce((s, v) => s + v, 0),
        by_user,
      }));

    // Requests per day + avg latency — PostgreSQL date extraction from ms timestamp
    const reqDayRows = await db.execute(sql`
      SELECT to_char(to_timestamp(ts / 1000.0), 'YYYY-MM-DD') AS day,
             COUNT(*) AS count,
             AVG(duration_ms) AS avg_lat,
             SUM(cache_read) AS cache_r,
             SUM(cache_creation) AS cache_c,
             SUM(input_tokens + output_tokens) AS tokens
      FROM request_logs
      WHERE ts >= ${cutoffMs}
      GROUP BY day ORDER BY day ASC
    `);

    // Stop reasons distribution
    const stopRows = await db.execute(sql`
      SELECT stop_reason, COUNT(*) AS count FROM request_logs
      WHERE stop_reason != '' GROUP BY stop_reason ORDER BY count DESC
    `);

    // Per-user stats (last 30 days)
    const userRows = await db.execute(sql`
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
    `);

    // Hourly distribution — PostgreSQL EXTRACT HOUR from ms timestamp
    const hourRows = await db.execute(sql`
      SELECT EXTRACT(HOUR FROM to_timestamp(ts / 1000.0))::INTEGER AS hour,
             COUNT(*) AS count
      FROM request_logs GROUP BY hour ORDER BY hour ASC
    `);

    // Cache summary
    const cacheRows = await db.execute(sql`
      SELECT SUM(input_tokens) AS total_inp,
             SUM(cache_read) AS cr,
             SUM(cache_creation) AS cc,
             SUM(input_tokens + cache_read + cache_creation) AS grand_total
      FROM request_logs WHERE ts >= ${cutoffMs}
    `);
    const cacheRow = ((cacheRows as any).rows ?? [])[0];

    return Response.json({
      daily,
      users: [...userSet],
      requests_by_day: ((reqDayRows as any).rows ?? []).map((r: any) => ({
        date: r.day, count: Number(r.count),
        avg_latency: Math.round(Number(r.avg_lat) || 0),
        cache_read: Number(r.cache_r) || 0,
        tokens: Number(r.tokens) || 0,
      })),
      stop_reasons: ((stopRows as any).rows ?? []).map((r: any) => ({
        reason: r.stop_reason || "unknown", count: Number(r.count),
      })),
      per_user: ((userRows as any).rows ?? []).map((r: any) => ({
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
        const row = ((hourRows as any).rows ?? []).find((r: any) => Number(r.hour) === i);
        return { hour: i, count: row ? Number(row.count) : 0 };
      }),
      cache_summary: {
        total_input:    Number(cacheRow?.total_inp) || 0,
        cache_read:     Number(cacheRow?.cr) || 0,
        cache_creation: Number(cacheRow?.cc) || 0,
        grand_total:    Number(cacheRow?.grand_total) || 0,
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return Response.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
