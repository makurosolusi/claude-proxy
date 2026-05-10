import { prisma } from "../prisma";

export async function handleApiMind(): Promise<Response> {
  const logs = await prisma.$queryRaw<any[]>`
    SELECT id, ts,
           COALESCE(NULLIF(name, ''), token_key) AS token_key,
           model,
           input_tokens + output_tokens + cache_read + cache_creation AS tokens,
           tool_use_count, stream, duration_ms, status, prompt
    FROM request_logs
    ORDER BY ts ASC
    LIMIT 2000
  `;

  const nodes: any[] = [];
  const links: any[] = [];

  const userStats = new Map<string, { requests: number; tokens: number }>();
  const dateStats = new Map<string, { user: string; date: string; requests: number; tokens: number }>();
  const hourStats = new Map<string, { user: string; date: string; hour: number; requests: number; tokens: number }>();

  for (const log of logs) {
    const user = log.token_key as string;
    const d    = new Date(Number(log.ts));
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const hour = d.getHours();
    const dateKey = `${user}::${date}`;
    const hourKey = `${user}::${date}::${String(hour).padStart(2, "0")}`;
    const reqId   = `req:${log.id}`;
    const modelShort = (log.model || "").replace(/^claude-/, "").replace(/-\d{8}$/, "");

    const u = userStats.get(user) ?? { requests: 0, tokens: 0 };
    u.requests++;
    u.tokens += Number(log.tokens) ?? 0;
    userStats.set(user, u);

    const ds = dateStats.get(dateKey) ?? { user, date, requests: 0, tokens: 0 };
    ds.requests++;
    ds.tokens += Number(log.tokens) ?? 0;
    dateStats.set(dateKey, ds);

    const hs = hourStats.get(hourKey) ?? { user, date, hour, requests: 0, tokens: 0 };
    hs.requests++;
    hs.tokens += Number(log.tokens) ?? 0;
    hourStats.set(hourKey, hs);

    nodes.push({
      id: reqId, name: modelShort, category: 3,
      tokens: Number(log.tokens) ?? 0, tools: log.tool_use_count ?? 0,
      duration: log.duration_ms ?? 0, status: log.status ?? 200,
      stream: log.stream ?? false, ts: Number(log.ts), model: modelShort,
      prompt: (log.prompt || "").slice(0, 80),
    });
    links.push({ source: hourKey, target: reqId, type: "hr", value: 1, tokens: Number(log.tokens) ?? 0 });
  }

  for (const [hourKey, hs] of hourStats.entries()) {
    nodes.push({ id: hourKey, name: `${String(hs.hour).padStart(2, "0")}:00`, category: 2, requests: hs.requests, tokens: hs.tokens });
    links.push({ source: `${hs.user}::${hs.date}`, target: hourKey, type: "dh", value: hs.requests, tokens: hs.tokens });
  }

  for (const [dateKey, ds] of dateStats.entries()) {
    nodes.push({ id: dateKey, name: ds.date.slice(5), category: 1, requests: ds.requests, tokens: ds.tokens, fullDate: ds.date });
    links.push({ source: ds.user, target: dateKey, type: "ud", value: ds.requests, tokens: ds.tokens });
  }

  for (const [user, us] of userStats.entries()) {
    nodes.push({ id: user, name: user, category: 0, requests: us.requests, tokens: us.tokens });
  }

  const totalRequests = [...userStats.values()].reduce((s, v) => s + v.requests, 0);
  const totalTokens   = [...userStats.values()].reduce((s, v) => s + v.tokens, 0);

  return Response.json({ nodes, links, totalRequests, totalTokens });
}
