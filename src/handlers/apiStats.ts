import { db, tokens, deriveNameFromKey } from "../state";

function keyToName(key: string): string {
  return tokens[key]?.name ?? deriveNameFromKey(key);
}

export function handleApiStats(): Response {
  try {
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

    // Daily token usage per user (from daily_usage table)
    const dailyRows = db.query(`
      SELECT date, token_key, used FROM daily_usage WHERE date >= ? ORDER BY date ASC
    `).all(cutoff) as any[];

    const dailyMap: Record<string, Record<string, number>> = {};
    const userSet = new Set<string>();
    for (const r of dailyRows) {
      const name = keyToName(r.token_key);
      if (!dailyMap[r.date]) dailyMap[r.date] = {};
      dailyMap[r.date][name] = (dailyMap[r.date][name] || 0) + r.used;
      userSet.add(name);
    }
    const daily = Object.entries(dailyMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, by_user]) => ({
        date,
        total: Object.values(by_user).reduce((s, v) => s + v, 0),
        by_user,
      }));

    // Requests per day + avg latency per day
    const reqDayRows = db.query(`
      SELECT date(ts/1000, 'unixepoch') as day,
             COUNT(*) as count,
             AVG(duration_ms) as avg_lat,
             SUM(cache_read) as cache_r,
             SUM(cache_creation) as cache_c,
             SUM(input_tokens+output_tokens) as tokens
      FROM request_logs
      WHERE ts >= ?
      GROUP BY day ORDER BY day ASC
    `).all(Date.now() - 30 * 86400000) as any[];

    // Stop reasons distribution
    const stopRows = db.query(`
      SELECT stop_reason, COUNT(*) as count FROM request_logs
      WHERE stop_reason != '' GROUP BY stop_reason ORDER BY count DESC
    `).all() as any[];

    // Per-user stats (last 30 days)
    const userRows = db.query(`
      SELECT token_key,
             COUNT(*) as requests,
             SUM(input_tokens) as inp,
             SUM(output_tokens) as out,
             SUM(cache_read) as cache_r,
             SUM(tool_use_count) as tools,
             AVG(duration_ms) as avg_lat,
             AVG(turns) as avg_turns
      FROM request_logs WHERE ts >= ?
      GROUP BY token_key ORDER BY requests DESC
    `).all(Date.now() - 30 * 86400000) as any[];

    // Hourly distribution (what hours are most active)
    const hourRows = db.query(`
      SELECT CAST(strftime('%H', ts/1000, 'unixepoch', 'localtime') AS INTEGER) as hour,
             COUNT(*) as count
      FROM request_logs GROUP BY hour ORDER BY hour ASC
    `).all() as any[];

    // Cache summary
    const cacheRow = db.query(`
      SELECT SUM(input_tokens) as total_inp,
             SUM(cache_read) as cr,
             SUM(cache_creation) as cc,
             SUM(input_tokens + cache_read + cache_creation) as grand_total
      FROM request_logs WHERE ts >= ?
    `).get(Date.now() - 30 * 86400000) as any;

    return Response.json({
      daily,
      users: [...userSet],
      requests_by_day: reqDayRows.map(r => ({
        date: r.day, count: r.count,
        avg_latency: Math.round(r.avg_lat || 0),
        cache_read: r.cache_r || 0,
        tokens: r.tokens || 0,
      })),
      stop_reasons: stopRows.map(r => ({ reason: r.stop_reason || "unknown", count: r.count })),
      per_user: userRows.map(r => ({
        user: keyToName(r.token_key),
        requests: r.requests,
        input_tokens: r.inp || 0,
        output_tokens: r.out || 0,
        cache_read: r.cache_r || 0,
        tools: r.tools || 0,
        avg_latency: Math.round(r.avg_lat || 0),
        avg_turns: Math.round(r.avg_turns || 0),
      })),
      hourly: Array.from({ length: 24 }, (_, i) => {
        const row = hourRows.find(r => r.hour === i);
        return { hour: i, count: row?.count || 0 };
      }),
      cache_summary: {
        total_input: cacheRow?.total_inp || 0,
        cache_read:  cacheRow?.cr || 0,
        cache_creation: cacheRow?.cc || 0,
        grand_total: cacheRow?.grand_total || 0,
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return Response.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
