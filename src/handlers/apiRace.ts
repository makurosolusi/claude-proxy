import { db } from "../state";

export function handleApiRace(): Response {
  try { db.exec("ALTER TABLE request_logs ADD COLUMN name TEXT DEFAULT ''"); } catch {}

  const span = db.query(`SELECT MIN(ts) as minTs, MAX(ts) as maxTs FROM request_logs`).get() as any;
  const spanMs = (span?.maxTs ?? 0) - (span?.minTs ?? 0);
  const useDay = spanMs > 7 * 24 * 60 * 60 * 1000;

  // Group by local hour or day depending on data span
  const periodExpr = useDay
    ? `strftime('%Y-%m-%d', datetime(ts/1000, 'unixepoch', 'localtime'))`
    : `strftime('%Y-%m-%d %H', datetime(ts/1000, 'unixepoch', 'localtime'))`;

  const rows = db.query(`
    SELECT
      ${periodExpr} AS period,
      COALESCE(NULLIF(name, ''), token_key) AS token_key,
      SUM(input_tokens + output_tokens + cache_read + cache_creation) AS tokens,
      COUNT(*) AS requests
    FROM request_logs
    GROUP BY period, token_key
    ORDER BY period ASC
  `).all() as { period: string; token_key: string; tokens: number; requests: number }[];

  const users = [...new Set(rows.map(r => r.token_key))];
  const periods = [...new Set(rows.map(r => r.period))].sort();

  // Delta per (period, user)
  const delta   = new Map<string, Map<string, number>>();
  const deltaReq = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (!delta.has(r.period))    delta.set(r.period, new Map());
    if (!deltaReq.has(r.period)) deltaReq.set(r.period, new Map());
    delta.get(r.period)!.set(r.token_key, r.tokens);
    deltaReq.get(r.period)!.set(r.token_key, r.requests);
  }

  // Compute cumulative frames
  const cumTok = new Map<string, number>();
  const cumReq = new Map<string, number>();
  users.forEach(u => { cumTok.set(u, 0); cumReq.set(u, 0); });

  const frames: { time: string; values: Record<string, number>; requests: Record<string, number> }[] = [];

  for (const period of periods) {
    const tokMap = delta.get(period) ?? new Map();
    const reqMap = deltaReq.get(period) ?? new Map();
    for (const u of users) {
      cumTok.set(u, (cumTok.get(u) ?? 0) + (tokMap.get(u) ?? 0));
      cumReq.set(u, (cumReq.get(u) ?? 0) + (reqMap.get(u) ?? 0));
    }
    const values: Record<string, number> = {};
    const requests: Record<string, number> = {};
    for (const u of users) {
      values[u]   = cumTok.get(u) ?? 0;
      requests[u] = cumReq.get(u) ?? 0;
    }
    frames.push({ time: period, values, requests });
  }

  return Response.json({ frames, users, granularity: useDay ? "day" : "hour" });
}
