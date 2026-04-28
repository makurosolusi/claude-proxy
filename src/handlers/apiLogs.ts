import { dbQueryLogs, dbCountLogs, dbGetLog, dbGetTokenKeys } from "../state";

function maskLog(log: any, isAdmin: boolean) {
  if (isAdmin) return log;
  return {
    id: log.id, ts: log.ts,
    token_key: (log.token_key || "").replace(/^sk-user-/, ""),  // masked: just the name
    model: log.model,
    input_tokens: log.input_tokens, output_tokens: log.output_tokens,
    stream: log.stream, status: log.status,
    stop_reason: log.stop_reason, duration_ms: log.duration_ms,
    tool_use_count: log.tool_use_count, turns: log.turns,
    prompt: (log.prompt || "").slice(0, 100),  // truncated
    system_prompt: "",  // hidden
    cache_read: 0, cache_creation: 0,  // hidden
  };
}

export function handleApiLogs(req: Request, url: URL, isAdmin = false): Response {
  const parts = url.pathname.split("/").filter(Boolean);

  // GET /api/logs/:id — single detail
  if (parts.length === 3 && parts[2] !== "") {
    const id = parseInt(parts[2]);
    if (isNaN(id)) return Response.json({ error: "Invalid id" }, { status: 400 });
    const log = dbGetLog(id);
    if (!log) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json(maskLog(log, isAdmin), { headers: { "Cache-Control": "no-store" } });
  }

  // GET /api/logs — paginated list
  const page  = Math.max(1, parseInt(url.searchParams.get("page")  || "1"));
  const limit = Math.min(100, Math.max(10, parseInt(url.searchParams.get("limit") || "25")));
  const user  = url.searchParams.get("user") || "";
  // For public, user filter uses masked name — resolve back to full key
  const userKey = !isAdmin && user
    ? dbGetTokenKeys().find(k => k.replace(/^sk-user-/, "") === user) || user
    : user;

  const logs  = dbQueryLogs(page, limit, userKey);
  const total = dbCountLogs(userKey);
  const pages = Math.max(1, Math.ceil(total / limit));
  const allKeys = dbGetTokenKeys();
  const users = isAdmin ? allKeys : allKeys.map(k => k.replace(/^sk-user-/, ""));

  return Response.json(
    { logs: logs.map(l => maskLog(l, isAdmin)), total, page, pages, limit, users },
    { headers: { "Cache-Control": "no-store" } }
  );
}
