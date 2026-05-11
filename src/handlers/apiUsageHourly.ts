import { prisma } from "../prisma";
import { startOfTodayMs } from "../date";

export async function handleApiUsageHourly(): Promise<Response> {
  const startMs = BigInt(startOfTodayMs());

  const rows = await prisma.$queryRaw<{ h: number; tokens: bigint; requests: bigint }[]>`
    SELECT EXTRACT(HOUR FROM to_timestamp(ts / 1000.0))::INTEGER AS h,
           SUM(input_tokens + output_tokens + cache_read + cache_creation) AS tokens,
           COUNT(*) AS requests
    FROM request_logs
    WHERE ts >= ${startMs}
    GROUP BY h
    ORDER BY h ASC
  `;

  const hours = Array.from({ length: 24 }, (_, i) => {
    const row = rows.find(r => Number(r.h) === i);
    return { h: i, tokens: row ? Number(row.tokens) : 0, requests: row ? Number(row.requests) : 0 };
  });

  return Response.json({ hours }, { headers: { "Cache-Control": "no-store" } });
}
