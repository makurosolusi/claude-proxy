import { db, recentLogs, dailyUsage, allTimePerUser, tokens, deriveNameFromKey } from "../state";
import { todayKey } from "../tokens";

function keyToName(key: string): string {
  return tokens[key]?.name ?? deriveNameFromKey(key);
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

export function handleApiAnalytics(isAdmin: boolean): Response {
  const today = todayKey();

  try { db.exec("ALTER TABLE request_logs ADD COLUMN name TEXT DEFAULT ''"); } catch {}
  try { db.exec("ALTER TABLE tokens ADD COLUMN name TEXT DEFAULT ''"); } catch {}

  // ── Model distribution (last 30 days) ────────────────────────────────────
  const modelRows = db.query(`
    SELECT model,
           COUNT(*) AS requests,
           SUM(input_tokens + output_tokens) AS tokens
    FROM request_logs
    GROUP BY model
    ORDER BY tokens DESC
  `).all() as { model: string; requests: number; tokens: number }[];
  const totalModelTok = modelRows.reduce((s, r) => s + r.tokens, 0) || 1;
  const modelDist = modelRows.map(r => ({
    model:    r.model.replace(/^claude-/, "").replace(/-\d{8}$/, ""),
    requests: r.requests,
    tokens:   r.tokens,
    pct:      Math.round((r.tokens / totalModelTok) * 100),
  }));

  // ── Cache hit rate per user ────────────────────────────────────────────────
  const cacheRows = db.query(`
    SELECT
      COALESCE(NULLIF(name, ''), token_key) AS display_name,
      SUM(input_tokens)  AS inp,
      SUM(cache_read)    AS cr,
      SUM(cache_creation)AS cc,
      COUNT(*)           AS reqs
    FROM request_logs
    WHERE status < 400
    GROUP BY display_name
  `).all() as { display_name: string; inp: number; cr: number; cc: number; reqs: number }[];

  const cacheHitRate = cacheRows.map(r => {
    const total  = r.inp + r.cr;
    const hitRate= total > 0 ? Math.round((r.cr / total) * 100) : 0;
    return { label: r.display_name, hitRate, totalInput: r.inp, totalCached: r.cr, requests: r.reqs };
  }).sort((a, b) => b.requests - a.requests);

  // ── Peak hours (last 7 days, all users) ────────────────────────────────────
  const sevenDaysAgo = Date.now() - 7 * 86400_000;
  const hourRows = db.query(`
    SELECT CAST(strftime('%H', datetime(ts/1000, 'unixepoch', 'localtime')) AS INTEGER) AS h,
           COUNT(*) AS requests,
           SUM(input_tokens + output_tokens) AS tokens
    FROM request_logs
    WHERE ts >= ${sevenDaysAgo} AND status < 400
    GROUP BY h
    ORDER BY h ASC
  `).all() as { h: number; requests: number; tokens: number }[];
  const peakHours = Array.from({ length: 24 }, (_, i) => {
    const row = hourRows.find(r => r.h === i);
    return { h: i, requests: row?.requests ?? 0, tokens: row?.tokens ?? 0 };
  });
  const peakHour = peakHours.reduce((m, h) => h.requests > m.requests ? h : m, peakHours[0]!);

  // ── Per-user peak hours ────────────────────────────────────────────────────
  const userHourRows = db.query(`
    SELECT
      COALESCE(NULLIF(name, ''), token_key) AS display_name,
      CAST(strftime('%H', datetime(ts/1000, 'unixepoch', 'localtime')) AS INTEGER) AS h,
      COUNT(*) AS requests
    FROM request_logs
    WHERE ts >= ${sevenDaysAgo} AND status < 400
    GROUP BY display_name, h
  `).all() as { display_name: string; h: number; requests: number }[];

  const userPeakHours: Record<string, { peak: number; peakRequests: number }> = {};
  for (const r of userHourRows) {
    const cur = userPeakHours[r.display_name];
    if (!cur || r.requests > cur.peakRequests) {
      userPeakHours[r.display_name] = { peak: r.h, peakRequests: r.requests };
    }
  }

  // ── Today leaderboard ────────────────────────────────────────────────────
  const todayUsage = dailyUsage[today] ?? {};
  const leaderboard = Object.entries(tokens)
    .map(([k, tk]) => {
      const todayV  = todayUsage[k] ?? 0;
      const alltimeV= allTimePerUser[k] ?? 0;
      const peak    = userPeakHours[tk.name];
      return { label: tk.name, today: todayV, alltime: alltimeV, peakHour: peak?.peak ?? null, paused: tk.paused };
    })
    .filter(e => e.alltime > 0)
    .sort((a, b) => b.today - a.today || b.alltime - a.alltime);

  // ── Anomaly scores (recent 100 requests) ─────────────────────────────────
  const anomalyRows = recentLogs.slice(0, 100).map(l => {
    const score = anomalyScore(l.input_tokens, l.output_tokens, l.tool_use_count, l.duration_ms);
    const label = l.name;  // always safe — display name only
    return {
      id:           l.id,
      ts:           l.ts,
      label,
      input_tokens: l.input_tokens,
      output_tokens:l.output_tokens,
      turns:        l.turns,
      tool_use:     l.tool_use_count,
      duration_ms:  l.duration_ms,
      score,
    };
  }).filter(r => r.score > 0).sort((a, b) => b.score - a.score).slice(0, 20);

  // ── Stop reason distribution ──────────────────────────────────────────────
  const stopRows = db.query(`
    SELECT stop_reason, COUNT(*) AS n
    FROM request_logs
    WHERE status < 400 AND stop_reason != ''
    GROUP BY stop_reason
    ORDER BY n DESC
  `).all() as { stop_reason: string; n: number }[];

  // ── Daily usage per user (last 30 days) — public ─────────────────────────
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const dailyRows = db.query(`
    SELECT date, token_key, used FROM daily_usage WHERE date >= ? ORDER BY date ASC
  `).all(cutoff) as { date: string; token_key: string; used: number }[];

  const dailyMap: Record<string, Record<string, number>> = {};
  const userSet = new Set<string>();
  for (const r of dailyRows) {
    const name = keyToName(r.token_key);
    if (!dailyMap[r.date]) dailyMap[r.date] = {};
    dailyMap[r.date][name] = (dailyMap[r.date][name] || 0) + r.used;
    userSet.add(name);
  }
  const dailyByUser = Object.entries(dailyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, by_user]) => ({ date, by_user }));

  return Response.json({
    modelDist,
    cacheHitRate,
    peakHours,
    peakHour: peakHour.h,
    leaderboard,
    anomalyScores: anomalyRows,
    stopReasonDist: stopRows,
    dailyByUser,
    dailyUsers: [...userSet],
  });
}
