import { db } from "../state";

export function handleApiUsageHourly(): Response {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startMs = startOfToday.getTime();

  const rows = db.query(`
    SELECT
      CAST(strftime('%H', datetime(ts/1000, 'unixepoch', 'localtime')) AS INTEGER) AS h,
      SUM(input_tokens + output_tokens + cache_read + cache_creation) AS tokens,
      COUNT(*) AS requests
    FROM request_logs
    WHERE ts >= ${startMs}
    GROUP BY h
  `).all() as { h: number; tokens: number; requests: number }[];

  const hours = Array.from({ length: 24 }, (_, i) => {
    const row = rows.find(r => r.h === i);
    return { h: i, tokens: row?.tokens ?? 0, requests: row?.requests ?? 0 };
  });

  return Response.json({ hours }, { headers: { "Cache-Control": "no-store" } });
}
