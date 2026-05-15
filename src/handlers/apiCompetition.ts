import { prisma } from "../prisma";
import { dailyUsage, tokens, users, allTimePerUser } from "../state";
import { todayKey } from "../tokens";
import { startOfTodayMs, localDateStr } from "../date";

interface DailyStreakRow {
  display_name: string;
  day: string;
  requests: bigint;
}

function prevDay(dateStr: string): string {
  return localDateStr(new Date(new Date(dateStr).getTime() - 86_400_000));
}

function calcStreak(user: string, rows: DailyStreakRow[], today: string): number {
  const days = rows
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

export async function handleApiCompetition(currentUserId: string): Promise<Response> {
  const now      = Date.now();
  const startMs  = BigInt(startOfTodayMs());
  const sevenMs  = BigInt(now - 7 * 86_400_000);
  const fourteenMs = BigInt(now - 14 * 86_400_000);
  const today    = todayKey();

  // ── 3 queries paralel ────────────────────────────────────────────────────────
  const [todayRows, heatRows, streakRows] = await Promise.all([

    // Today per-user totals
    prisma.$queryRaw<{ display_name: string; user_id: string; tokens: bigint; requests: bigint }[]>`
      SELECT COALESCE(NULLIF(name, ''), token_key)         AS display_name,
             COALESCE(NULLIF(user_id, ''), token_key)      AS user_id,
             SUM(input_tokens + output_tokens + cache_read + cache_creation) AS tokens,
             COUNT(*) AS requests
      FROM request_logs
      WHERE ts >= ${startMs} AND status < 400
      GROUP BY COALESCE(NULLIF(name, ''), token_key),
               COALESCE(NULLIF(user_id, ''), token_key)
      ORDER BY tokens DESC
    `,

    // Community heatmap: day × hour, last 7 days (aggregated, no per-user)
    prisma.$queryRaw<{ day: string; h: number; requests: bigint; tokens: bigint }[]>`
      SELECT to_char(to_timestamp(ts / 1000.0), 'YYYY-MM-DD') AS day,
             EXTRACT(HOUR FROM to_timestamp(ts / 1000.0))::INTEGER AS h,
             COUNT(*) AS requests,
             SUM(input_tokens + output_tokens + cache_read + cache_creation) AS tokens
      FROM request_logs
      WHERE ts >= ${sevenMs} AND status < 400
      GROUP BY to_char(to_timestamp(ts / 1000.0), 'YYYY-MM-DD'),
               EXTRACT(HOUR FROM to_timestamp(ts / 1000.0))::INTEGER
      ORDER BY day, h
    `,

    // Streak: daily activity last 14 days
    prisma.$queryRaw<DailyStreakRow[]>`
      SELECT COALESCE(NULLIF(name, ''), token_key) AS display_name,
             to_char(to_timestamp(ts / 1000.0), 'YYYY-MM-DD') AS day,
             COUNT(*) AS requests
      FROM request_logs
      WHERE ts >= ${fourteenMs} AND status < 400
      GROUP BY COALESCE(NULLIF(name, ''), token_key),
               to_char(to_timestamp(ts / 1000.0), 'YYYY-MM-DD')
    `,
  ]);

  // ── Leaderboard ──────────────────────────────────────────────────────────────
  const todayUsageMap = dailyUsage[today] ?? {};

  // Kumpulkan semua user yang punya token aktif
  const userTokenMap: Record<string, { name: string; userId: string }> = {};
  for (const [key, tk] of Object.entries(tokens)) {
    if (!tk.user_id) continue;
    const u = users[tk.user_id];
    userTokenMap[key] = { name: u?.name || tk.label || key, userId: tk.user_id };
  }

  // Merge today rows dengan streak
  const leaderboard = todayRows.map((r, idx) => {
    const displayName = r.display_name;
    const tokensToday = Number(r.tokens);
    const requests    = Number(r.requests);
    const streak      = calcStreak(displayName, streakRows, today);

    // Cari userId dari token yang match display_name
    let userId = r.user_id;
    for (const [, v] of Object.entries(userTokenMap)) {
      if (v.name === displayName) { userId = v.userId; break; }
    }

    // alltime
    const alltime = allTimePerUser[userId] || allTimePerUser[displayName] || 0;

    return {
      rank:         idx + 1,
      name:         displayName,
      userId,
      tokens_today: tokensToday,
      requests_today: requests,
      streak_days:  streak,
      alltime_tokens: alltime,
      is_me:        userId === currentUserId || displayName === (users[currentUserId]?.name || currentUserId),
    };
  });

  // ── Community heatmap ────────────────────────────────────────────────────────
  // Format: { day, hours: [{ h, requests, tokens }] }
  const heatDays = [...new Set(heatRows.map(r => r.day))].sort();
  const heatmap = heatDays.map(day => ({
    day,
    hours: Array.from({ length: 24 }, (_, h) => {
      const row = heatRows.find(r => r.day === day && Number(r.h) === h);
      return { h, requests: row ? Number(row.requests) : 0, tokens: row ? Number(row.tokens) : 0 };
    }),
  }));

  // ── "Me" stats ───────────────────────────────────────────────────────────────
  const me = leaderboard.find(e => e.is_me) ?? null;
  const totalParticipants = leaderboard.length;
  const avgTokens = totalParticipants > 0
    ? Math.round(leaderboard.reduce((s, e) => s + e.tokens_today, 0) / totalParticipants)
    : 0;
  const topStreak = Math.max(...leaderboard.map(e => e.streak_days), 0);

  return Response.json({
    leaderboard,
    heatmap,
    today,
    me_stats: me ? {
      rank:         me.rank,
      total:        totalParticipants,
      tokens_today: me.tokens_today,
      avg_tokens:   avgTokens,
      vs_avg_pct:   avgTokens > 0 ? Math.round(((me.tokens_today - avgTokens) / avgTokens) * 100) : 0,
      streak_days:  me.streak_days,
      top_streak:   topStreak,
    } : null,
    community: {
      total_participants: totalParticipants,
      avg_tokens:   avgTokens,
      top_streak:   topStreak,
    },
    generated_at: new Date().toISOString(),
  }, { headers: { "Cache-Control": "no-store" } });
}
