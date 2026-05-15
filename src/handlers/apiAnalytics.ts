import { prisma } from "../prisma";
import { recentLogs, dailyUsage, allTimePerUser, tokens, resolveTokenName, resolveOwnerName, deriveNameFromKey } from "../state";
import { todayKey } from "../tokens";
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
  const today        = todayKey();
  const nameMap      = await buildKeyToName();
  const sevenDaysAgo = BigInt(Date.now() - 7 * 86400_000);

  // Model distribution
  const modelRows = await prisma.request_logs.groupBy({
    by: ["model"],
    _count: true,
    _sum: { input_tokens: true, output_tokens: true },
    orderBy: { _sum: { input_tokens: "desc" } },
  });
  const totalModelTok = modelRows.reduce((s, r) => s + (r._sum.input_tokens ?? 0) + (r._sum.output_tokens ?? 0), 0) || 1;
  const modelDist = modelRows.map(r => {
    const tok = (r._sum.input_tokens ?? 0) + (r._sum.output_tokens ?? 0);
    return {
      model:    r.model.replace(/^claude-/, "").replace(/-\d{8}$/, ""),
      requests: r._count,
      tokens:   tok,
      pct:      Math.round((tok / totalModelTok) * 100),
    };
  });

  // Cache hit rate per user
  const cacheRows = await prisma.$queryRaw<{ display_name: string; inp: bigint; cr: bigint; cc: bigint; reqs: bigint }[]>`
    SELECT COALESCE(NULLIF(name, ''), token_key) AS display_name,
           SUM(input_tokens) AS inp, SUM(cache_read) AS cr,
           SUM(cache_creation) AS cc, COUNT(*) AS reqs
    FROM request_logs WHERE status < 400
    GROUP BY display_name
  `;
  const cacheHitRate = cacheRows.map(r => {
    const total   = Number(r.inp) + Number(r.cr);
    const hitRate = total > 0 ? Math.round((Number(r.cr) / total) * 100) : 0;
    return { label: r.display_name, hitRate, totalInput: Number(r.inp), totalCached: Number(r.cr), requests: Number(r.reqs) };
  }).sort((a, b) => b.requests - a.requests);

  // Peak hours (last 7 days)
  const hourRows = await prisma.$queryRaw<{ h: number; requests: bigint; tokens: bigint }[]>`
    SELECT EXTRACT(HOUR FROM to_timestamp(ts / 1000.0))::INTEGER AS h,
           COUNT(*) AS requests,
           SUM(input_tokens + output_tokens) AS tokens
    FROM request_logs
    WHERE ts >= ${sevenDaysAgo} AND status < 400
    GROUP BY h ORDER BY h ASC
  `;
  const peakHours = Array.from({ length: 24 }, (_, i) => {
    const row = hourRows.find(r => Number(r.h) === i);
    return { h: i, requests: row ? Number(row.requests) : 0, tokens: row ? Number(row.tokens) : 0 };
  });
  const peakHour = peakHours.reduce((m, h) => h.requests > m.requests ? h : m, peakHours[0]!);

  // Per-user peak hours
  const userHourRows = await prisma.$queryRaw<{ display_name: string; h: number; requests: bigint }[]>`
    SELECT COALESCE(NULLIF(name, ''), token_key) AS display_name,
           EXTRACT(HOUR FROM to_timestamp(ts / 1000.0))::INTEGER AS h,
           COUNT(*) AS requests
    FROM request_logs
    WHERE ts >= ${sevenDaysAgo} AND status < 400
    GROUP BY display_name, h
  `;
  const userPeakHours: Record<string, { peak: number; peakRequests: number }> = {};
  for (const r of userHourRows) {
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
      const label    = resolveOwnerName(tk) || tk.label || deriveNameFromKey(k);
      const peak     = userPeakHours[label];
      return { label, today: todayV, alltime: alltimeV, peakHour: peak?.peak ?? null, paused: tk.paused };
    })
    .filter(e => e.alltime > 0)
    .sort((a, b) => b.today - a.today || b.alltime - a.alltime);

  // Anomaly scores
  const anomalyRows = recentLogs.slice(0, 100).map(l => {
    const score = anomalyScore(l.input_tokens, l.output_tokens, l.tool_use_count, l.duration_ms);
    return { id: l.id, ts: l.ts, label: l.name, input_tokens: l.input_tokens, output_tokens: l.output_tokens, turns: l.turns, tool_use: l.tool_use_count, duration_ms: l.duration_ms, score };
  }).filter(r => r.score > 0).sort((a, b) => b.score - a.score).slice(0, 20);

  // Stop reason distribution
  const stopRows = await prisma.request_logs.groupBy({
    by: ["stop_reason"],
    where: { status: { lt: 400 }, stop_reason: { not: "" } },
    _count: true,
    orderBy: { _count: { stop_reason: "desc" } },
  });

  // Daily usage per user (last 30 days)
  const cutoff = localDateStr(new Date(Date.now() - 30 * 86400000));
  const dailyRows = await prisma.daily_usage.findMany({ where: { date: { gte: cutoff } }, orderBy: { date: "asc" } });
  const dailyMap: Record<string, Record<string, number>> = {};
  const userSet = new Set<string>();
  for (const r of dailyRows) {
    const name = keyToName(nameMap, r.token_key);
    if (!dailyMap[r.date]) dailyMap[r.date] = {};
    dailyMap[r.date][name] = (dailyMap[r.date][name] || 0) + r.used;
    userSet.add(name);
  }
  const dailyByUser = Object.entries(dailyMap).sort(([a], [b]) => a.localeCompare(b)).map(([date, by_user]) => ({ date, by_user }));

  // All-time per user
  const allTimeRows = await prisma.request_logs.groupBy({
    by: ["token_key"],
    where: { status: { lt: 400 } },
    _sum: { input_tokens: true, output_tokens: true, cache_read: true, cache_creation: true },
    orderBy: { _sum: { input_tokens: "desc" } },
  });
  const allTimeAgg: Record<string, number> = {};
  for (const r of allTimeRows) {
    const name = keyToName(nameMap, r.token_key);
    allTimeAgg[name] = (allTimeAgg[name] || 0) +
      (r._sum.input_tokens ?? 0) + (r._sum.output_tokens ?? 0) +
      (r._sum.cache_read ?? 0) + (r._sum.cache_creation ?? 0);
  }
  const allTimeByUser = Object.entries(allTimeAgg).sort(([, a], [, b]) => b - a).map(([user, total]) => ({ user, total }));

  return Response.json({
    modelDist, cacheHitRate, peakHours, peakHour: peakHour.h,
    leaderboard, anomalyScores: anomalyRows,
    stopReasonDist: stopRows.map(r => ({ stop_reason: r.stop_reason, n: r._count })),
    dailyByUser, dailyUsers: [...userSet], allTimeByUser,
  });
}
