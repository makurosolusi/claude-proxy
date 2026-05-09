import { sql } from "drizzle-orm";
import { db } from "../db";
import { recentLogs, dailyUsage, allTimePerUser, tokens, resolveTokenName, deriveNameFromKey } from "../state";
import { todayKey } from "../tokens";

async function buildKeyToName(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const rows = await db.execute(sql`
    SELECT t.key, t.name, t.user_id, u.name as user_name
    FROM tokens t LEFT JOIN users u ON t.user_id = u.id
  `);
  for (const r of (rows as any).rows ?? []) {
    map.set(r.key, r.user_name || r.name || deriveNameFromKey(r.key));
  }
  return map;
}

function keyToName(map: Map<string, string>, key: string): string {
  return map.get(key) ?? resolveTokenName(key, tokens[key]) ?? deriveNameFromKey(key);
}

function anomalyScore(inp: number, out: number, toolUse: number, durationMs: number): number {
  let score = 0;
  if (inp > 100_000) score += 40;
  else if (inp > 50_000) score += 20;
  else if (inp > 20_000) score += 8;
  const ratio = inp / Math.max(out, 1);
  if (ratio > 100) score += 25;
  else if (ratio > 50) score += 12;
  else if (ratio > 20) score += 5;
  if (toolUse > 20) score += 20;
  else if (toolUse > 10) score += 10;
  else if (toolUse > 5) score += 4;
  if (durationMs > 300_000) score += 15;
  else if (durationMs > 120_000) score += 7;
  return Math.min(score, 100);
}

export async function handleApiAnalytics(isAdmin: boolean): Promise<Response> {
  const today   = todayKey();
  const nameMap = await buildKeyToName();
  const sevenDaysAgo = Date.now() - 7 * 86400_000;

  // Model distribution
  const modelRows = await db.execute(sql`
    SELECT model,
           COUNT(*) AS requests,
           SUM(input_tokens + output_tokens) AS tokens
    FROM request_logs
    GROUP BY model
    ORDER BY tokens DESC
  `);
  const modelData = (modelRows as any).rows ?? [];
  const totalModelTok = modelData.reduce((s: number, r: any) => s + Number(r.tokens), 0) || 1;
  const modelDist = modelData.map((r: any) => ({
    model:    (r.model as string).replace(/^claude-/, "").replace(/-\d{8}$/, ""),
    requests: Number(r.requests),
    tokens:   Number(r.tokens),
    pct:      Math.round((Number(r.tokens) / totalModelTok) * 100),
  }));

  // Cache hit rate per user
  const cacheRows = await db.execute(sql`
    SELECT
      COALESCE(NULLIF(name, ''), token_key) AS display_name,
      SUM(input_tokens)   AS inp,
      SUM(cache_read)     AS cr,
      SUM(cache_creation) AS cc,
      COUNT(*)            AS reqs
    FROM request_logs
    WHERE status < 400
    GROUP BY display_name
  `);
  const cacheHitRate = ((cacheRows as any).rows ?? []).map((r: any) => {
    const total   = Number(r.inp) + Number(r.cr);
    const hitRate = total > 0 ? Math.round((Number(r.cr) / total) * 100) : 0;
    return {
      label: r.display_name, hitRate,
      totalInput: Number(r.inp), totalCached: Number(r.cr), requests: Number(r.reqs),
    };
  }).sort((a: any, b: any) => b.requests - a.requests);

  // Peak hours (last 7 days) — PostgreSQL EXTRACT
  const hourRows = await db.execute(sql`
    SELECT EXTRACT(HOUR FROM to_timestamp(ts / 1000.0))::INTEGER AS h,
           COUNT(*) AS requests,
           SUM(input_tokens + output_tokens) AS tokens
    FROM request_logs
    WHERE ts >= ${sevenDaysAgo} AND status < 400
    GROUP BY h
    ORDER BY h ASC
  `);
  const peakHours = Array.from({ length: 24 }, (_, i) => {
    const row = ((hourRows as any).rows ?? []).find((r: any) => Number(r.h) === i);
    return { h: i, requests: row ? Number(row.requests) : 0, tokens: row ? Number(row.tokens) : 0 };
  });
  const peakHour = peakHours.reduce((m, h) => h.requests > m.requests ? h : m, peakHours[0]!);

  // Per-user peak hours
  const userHourRows = await db.execute(sql`
    SELECT
      COALESCE(NULLIF(name, ''), token_key) AS display_name,
      EXTRACT(HOUR FROM to_timestamp(ts / 1000.0))::INTEGER AS h,
      COUNT(*) AS requests
    FROM request_logs
    WHERE ts >= ${sevenDaysAgo} AND status < 400
    GROUP BY display_name, h
  `);
  const userPeakHours: Record<string, { peak: number; peakRequests: number }> = {};
  for (const r of (userHourRows as any).rows ?? []) {
    const cur = userPeakHours[r.display_name];
    if (!cur || Number(r.requests) > cur.peakRequests) {
      userPeakHours[r.display_name] = { peak: Number(r.h), peakRequests: Number(r.requests) };
    }
  }

  // Today leaderboard
  const todayUsage = dailyUsage[today] ?? {};
  const leaderboard = Object.entries(tokens)
    .map(([k, tk]) => {
      const todayV   = todayUsage[k] ?? 0;
      const alltimeV = allTimePerUser[k] ?? 0;
      const peak     = userPeakHours[tk.name];
      return { label: tk.name, today: todayV, alltime: alltimeV, peakHour: peak?.peak ?? null, paused: tk.paused };
    })
    .filter(e => e.alltime > 0)
    .sort((a, b) => b.today - a.today || b.alltime - a.alltime);

  // Anomaly scores (recent 100 requests)
  const anomalyRows = recentLogs.slice(0, 100).map(l => {
    const score = anomalyScore(l.input_tokens, l.output_tokens, l.tool_use_count, l.duration_ms);
    return {
      id: l.id, ts: l.ts, label: l.name,
      input_tokens: l.input_tokens, output_tokens: l.output_tokens,
      turns: l.turns, tool_use: l.tool_use_count, duration_ms: l.duration_ms, score,
    };
  }).filter(r => r.score > 0).sort((a, b) => b.score - a.score).slice(0, 20);

  // Stop reason distribution
  const stopRows = await db.execute(sql`
    SELECT stop_reason, COUNT(*) AS n
    FROM request_logs
    WHERE status < 400 AND stop_reason != ''
    GROUP BY stop_reason
    ORDER BY n DESC
  `);

  // Daily usage per user (last 30 days)
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const dailyRows = await db.execute(sql`
    SELECT date, token_key, used FROM daily_usage WHERE date >= ${cutoff} ORDER BY date ASC
  `);
  const dailyMap: Record<string, Record<string, number>> = {};
  const userSet = new Set<string>();
  for (const r of (dailyRows as any).rows ?? []) {
    const name = keyToName(nameMap, r.token_key);
    if (!dailyMap[r.date]) dailyMap[r.date] = {};
    dailyMap[r.date][name] = (dailyMap[r.date][name] || 0) + Number(r.used);
    userSet.add(name);
  }
  const dailyByUser = Object.entries(dailyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, by_user]) => ({ date, by_user }));

  // All-time per user
  const allTimeRows = await db.execute(sql`
    SELECT token_key,
           SUM(input_tokens + output_tokens + cache_read + cache_creation) AS total
    FROM request_logs WHERE status < 400
    GROUP BY token_key ORDER BY total DESC
  `);
  const allTimeAgg: Record<string, number> = {};
  for (const r of (allTimeRows as any).rows ?? []) {
    const name = keyToName(nameMap, r.token_key);
    allTimeAgg[name] = (allTimeAgg[name] || 0) + Number(r.total || 0);
  }
  const allTimeByUser = Object.entries(allTimeAgg)
    .sort(([, a], [, b]) => b - a)
    .map(([user, total]) => ({ user, total }));

  return Response.json({
    modelDist, cacheHitRate, peakHours,
    peakHour: peakHour.h,
    leaderboard, anomalyScores: anomalyRows,
    stopReasonDist: ((stopRows as any).rows ?? []).map((r: any) => ({ stop_reason: r.stop_reason, n: Number(r.n) })),
    dailyByUser, dailyUsers: [...userSet], allTimeByUser,
  });
}
