import { sql } from "drizzle-orm";
import { db } from "../db";

export async function handleApiUsageHourly(): Promise<Response> {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startMs = startOfToday.getTime();

  const rows = await db.execute(sql`
    SELECT
      EXTRACT(HOUR FROM to_timestamp(ts / 1000.0))::INTEGER AS h,
      SUM(input_tokens + output_tokens + cache_read + cache_creation) AS tokens,
      COUNT(*) AS requests
    FROM request_logs
    WHERE ts >= ${startMs}
    GROUP BY h
    ORDER BY h ASC
  `);

  const hours = Array.from({ length: 24 }, (_, i) => {
    const row = ((rows as any).rows ?? []).find((r: any) => Number(r.h) === i);
    return { h: i, tokens: row ? Number(row.tokens) : 0, requests: row ? Number(row.requests) : 0 };
  });

  return Response.json({ hours }, { headers: { "Cache-Control": "no-store" } });
}
