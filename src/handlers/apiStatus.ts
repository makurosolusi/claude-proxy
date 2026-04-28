import { tokens, upstream, dailyUsage } from "../state";
import { maskToken, todayKey } from "../tokens";

function fmtCd(ms: number) {
  if (ms <= 0) return "now";
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

export function handleApiStatus(req: Request, url: URL, isAdmin: boolean): Response {
  const now   = Date.now();
  const today = todayKey();

  const tokenData: Record<string, any> = {};
  for (const [k, tk] of Object.entries(tokens)) {
    tokenData[k] = {
      label:     isAdmin ? k : maskToken(k),
      used:      tk.used,
      limit:     tk.limit === Infinity ? null : tk.limit,
      remaining: tk.limit === Infinity ? null : Math.max(0, tk.limit - tk.used),
      pct:       tk.limit === Infinity ? 0 : Math.round((tk.used / tk.limit) * 100),
      paused:    tk.paused,
      today:     (dailyUsage[today] || {})[k] || 0,
    };
  }

  return Response.json({
    ts:      new Date().toISOString(),
    pollAge: upstream.lastPoll ? fmtCd(now - upstream.lastPoll) + " ago" : "pending",
    isAdmin,
    tokens:  tokenData,
    upstream: {
      ok:     upstream.lastPollOk,
      stale:  !upstream.lastPollOk && !!upstream.fiveHour,
      error:  isAdmin ? upstream.lastError : null,
      email:  isAdmin ? upstream.tokenCache.email : null,
      pollAge:   upstream.lastPoll ? fmtCd(now - upstream.lastPoll) : null,
      nextPoll:  upstream.pollBackoffUntil > now ? fmtCd(upstream.pollBackoffUntil - now) : null,
      fiveHour:       upstream.fiveHour,
      sevenDay:       upstream.sevenDay,
      sevenDaySonnet: upstream.sevenDaySonnet,
      sevenDayOpus:   upstream.sevenDayOpus,
    },
  }, { headers: { "Cache-Control": "no-store" } });
}
