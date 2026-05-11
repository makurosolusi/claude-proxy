import { prisma } from "../prisma";

interface HourlyRow {
  display_name: string;
  h: number;
  requests: bigint;
  tokens: bigint;
  input_tokens: bigint;
  cache_read: bigint;
  avg_duration_ms: number;
}

interface DailyRow {
  display_name: string;
  day: string;
  requests: bigint;
  tokens: bigint;
  cache_read: bigint;
  input_tokens: bigint;
}

interface TodayRow {
  display_name: string;
  requests: bigint;
  tokens: bigint;
  cache_read: bigint;
  input_tokens: bigint;
  avg_duration_ms: number;
  avg_turns: number;
  top_model: string | null;
}

function prevDay(dateStr: string): string {
  return new Date(new Date(dateStr).getTime() - 86_400_000).toISOString().slice(0, 10);
}

function calcStreak(user: string, dailyRows: DailyRow[], today: string): number {
  const days = dailyRows
    .filter(r => r.display_name === user && Number(r.requests) > 0)
    .map(r => r.day)
    .sort()
    .reverse();
  let streak = 0;
  let cursor = today;
  for (const day of days) {
    if (day === cursor) { streak++; cursor = prevDay(cursor); }
    else if (day < cursor) break;
  }
  return streak;
}

function productivityScore(p: {
  today_tokens: number; today_requests: number;
  cache_hit_rate: number; avg_turns: number; streak_days: number;
}): number {
  const tokenScore  = Math.min(40, (p.today_tokens  / 50_000) * 40);
  const streakScore = Math.min(20, p.streak_days * 4);
  const cacheScore  = (p.cache_hit_rate / 100) * 20;
  const turnScore   = Math.min(10, (p.avg_turns / 5) * 10);
  const reqScore    = Math.min(10, (p.today_requests / 20) * 10);
  return Math.round(tokenScore + streakScore + cacheScore + turnScore + reqScore);
}

export async function handleApiUserActivity(): Promise<Response> {
  const now          = Date.now();
  const todayDate    = new Date(now);
  todayDate.setHours(0, 0, 0, 0);
  const startMs      = BigInt(todayDate.getTime());
  const cutoff30dMs  = BigInt(now - 30 * 86_400_000);
  const today        = new Date(now).toISOString().slice(0, 10);

  const [hourlyRows, dailyRows, todayRows] = await Promise.all([
    prisma.$queryRaw<HourlyRow[]>`
      SELECT COALESCE(NULLIF(name, ''), token_key) AS display_name,
             EXTRACT(HOUR FROM to_timestamp(ts / 1000.0))::INTEGER AS h,
             COUNT(*) AS requests,
             SUM(input_tokens + output_tokens + cache_read + cache_creation) AS tokens,
             SUM(input_tokens) AS input_tokens,
             SUM(cache_read) AS cache_read,
             AVG(duration_ms) AS avg_duration_ms
      FROM request_logs
      WHERE ts >= ${startMs} AND status < 400
      GROUP BY display_name, h
      ORDER BY display_name, h
    `,
    prisma.$queryRaw<DailyRow[]>`
      SELECT COALESCE(NULLIF(name, ''), token_key) AS display_name,
             to_char(to_timestamp(ts / 1000.0), 'YYYY-MM-DD') AS day,
             COUNT(*) AS requests,
             SUM(input_tokens + output_tokens + cache_read + cache_creation) AS tokens,
             SUM(cache_read) AS cache_read,
             SUM(input_tokens) AS input_tokens
      FROM request_logs
      WHERE ts >= ${cutoff30dMs} AND status < 400
      GROUP BY display_name, day
      ORDER BY display_name, day
    `,
    prisma.$queryRaw<TodayRow[]>`
      SELECT COALESCE(NULLIF(name, ''), token_key) AS display_name,
             COUNT(*) AS requests,
             SUM(input_tokens + output_tokens + cache_read + cache_creation) AS tokens,
             SUM(cache_read) AS cache_read,
             SUM(input_tokens) AS input_tokens,
             AVG(duration_ms) AS avg_duration_ms,
             AVG(turns) AS avg_turns,
             MODE() WITHIN GROUP (ORDER BY model) AS top_model
      FROM request_logs
      WHERE ts >= ${startMs} AND status < 400
      GROUP BY display_name
      ORDER BY tokens DESC
    `,
  ]);

  const users = [...new Set([
    ...hourlyRows.map(r => r.display_name),
    ...dailyRows.map(r => r.display_name),
    ...todayRows.map(r => r.display_name),
  ])].sort();

  const leaderboard = todayRows.map(r => {
    const user          = r.display_name;
    const todayTokens   = Number(r.tokens);
    const todayRequests = Number(r.requests);
    const inp           = Number(r.input_tokens);
    const cr            = Number(r.cache_read);
    const cacheHitRate  = (inp + cr) > 0 ? Math.round((cr / (inp + cr)) * 100) : 0;
    const streakDays    = calcStreak(user, dailyRows, today);
    const avgTurns      = Math.round(Number(r.avg_turns) * 10) / 10;
    const score         = productivityScore({ today_tokens: todayTokens, today_requests: todayRequests, cache_hit_rate: cacheHitRate, avg_turns: avgTurns, streak_days: streakDays });
    return {
      user,
      today_tokens:        todayTokens,
      today_requests:      todayRequests,
      streak_days:         streakDays,
      cache_hit_rate:      cacheHitRate,
      avg_latency_ms:      Math.round(Number(r.avg_duration_ms)),
      avg_turns:           avgTurns,
      top_model:           (r.top_model || "").replace(/^claude-/, "").replace(/-\d{8}$/, "") || "—",
      productivity_score:  score,
    };
  }).sort((a, b) => b.productivity_score - a.productivity_score);

  return Response.json({
    hourly: hourlyRows.map(r => ({
      user:            r.display_name,
      h:               Number(r.h),
      requests:        Number(r.requests),
      tokens:          Number(r.tokens),
      input_tokens:    Number(r.input_tokens),
      cache_read:      Number(r.cache_read),
      avg_duration_ms: Math.round(Number(r.avg_duration_ms)),
    })),
    daily: dailyRows.map(r => ({
      user:         r.display_name,
      day:          r.day,
      requests:     Number(r.requests),
      tokens:       Number(r.tokens),
      cache_read:   Number(r.cache_read),
      input_tokens: Number(r.input_tokens),
    })),
    leaderboard,
    users,
    generated_at: new Date().toISOString(),
  }, { headers: { "Cache-Control": "no-store" } });
}
