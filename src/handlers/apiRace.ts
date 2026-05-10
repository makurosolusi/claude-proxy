import { prisma } from "../prisma";

export async function handleApiRace(): Promise<Response> {
  const spanRow = await prisma.$queryRaw<{ minTs: bigint; maxTs: bigint }[]>`
    SELECT MIN(ts) as "minTs", MAX(ts) as "maxTs" FROM request_logs
  `;
  const span   = spanRow[0];
  const spanMs = (Number(span?.maxTs) ?? 0) - (Number(span?.minTs) ?? 0);
  const useDay = spanMs > 7 * 24 * 60 * 60 * 1000;

  type RaceRow = { period: string; token_key: string; tokens: bigint; requests: bigint };

  const rawRows = useDay
    ? await prisma.$queryRaw<RaceRow[]>`
        SELECT to_char(to_timestamp(ts / 1000.0), 'YYYY-MM-DD') AS period,
               COALESCE(NULLIF(name, ''), token_key) AS token_key,
               SUM(input_tokens + output_tokens + cache_read + cache_creation) AS tokens,
               COUNT(*) AS requests
        FROM request_logs
        GROUP BY period, token_key
        ORDER BY period ASC
      `
    : await prisma.$queryRaw<RaceRow[]>`
        SELECT to_char(to_timestamp(ts / 1000.0), 'YYYY-MM-DD HH24') AS period,
               COALESCE(NULLIF(name, ''), token_key) AS token_key,
               SUM(input_tokens + output_tokens + cache_read + cache_creation) AS tokens,
               COUNT(*) AS requests
        FROM request_logs
        GROUP BY period, token_key
        ORDER BY period ASC
      `;

  const users   = [...new Set(rawRows.map(r => r.token_key))];
  const periods = [...new Set(rawRows.map(r => r.period))].sort();

  const delta    = new Map<string, Map<string, number>>();
  const deltaReq = new Map<string, Map<string, number>>();
  for (const r of rawRows) {
    if (!delta.has(r.period))    delta.set(r.period, new Map());
    if (!deltaReq.has(r.period)) deltaReq.set(r.period, new Map());
    delta.get(r.period)!.set(r.token_key, Number(r.tokens));
    deltaReq.get(r.period)!.set(r.token_key, Number(r.requests));
  }

  const cumTok = new Map<string, number>();
  const cumReq = new Map<string, number>();
  users.forEach(u => { cumTok.set(u, 0); cumReq.set(u, 0); });

  const frames: { time: string; values: Record<string, number>; requests: Record<string, number> }[] = [];
  for (const period of periods) {
    const tokMap = delta.get(period)    ?? new Map();
    const reqMap = deltaReq.get(period) ?? new Map();
    for (const u of users) {
      cumTok.set(u, (cumTok.get(u) ?? 0) + (tokMap.get(u) ?? 0));
      cumReq.set(u, (cumReq.get(u) ?? 0) + (reqMap.get(u) ?? 0));
    }
    const values:   Record<string, number> = {};
    const requests: Record<string, number> = {};
    for (const u of users) {
      values[u]   = cumTok.get(u) ?? 0;
      requests[u] = cumReq.get(u) ?? 0;
    }
    frames.push({ time: period, values, requests });
  }

  return Response.json({ frames, users, granularity: useDay ? "day" : "hour" });
}
