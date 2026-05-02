import { dbQueryLogs, dbCountLogs, dbGetLog, dbGetTokenNames, tokens } from "../state";

function maskLog(log: any, isAdmin: boolean) {
  // name is always safe — it's the display name, not the secret key
  const base = {
    id: log.id, ts: log.ts,
    name: log.name,
    token_key: isAdmin ? log.token_key : log.name,  // non-admin never sees raw key
    model: log.model,
    input_tokens: log.input_tokens, output_tokens: log.output_tokens,
    stream: log.stream, status: log.status,
    stop_reason: log.stop_reason, duration_ms: log.duration_ms,
    tool_use_count: log.tool_use_count, turns: log.turns,
    messages_json: log.messages_json, response_text: log.response_text,
    prompt:        isAdmin ? log.prompt        : (log.prompt || "").slice(0, 100),
    system_prompt: isAdmin ? log.system_prompt : "",
    cache_read:    isAdmin ? log.cache_read    : 0,
    cache_creation:isAdmin ? log.cache_creation: 0,
  };
  return base;
}

export function handleApiLogs(req: Request, url: URL, isAdmin = false): Response {
  const parts = url.pathname.split("/").filter(Boolean);

  // GET /api/logs/:id
  if (parts.length === 3 && parts[2] !== "") {
    const id = parseInt(parts[2]);
    if (isNaN(id)) return Response.json({ error: "Invalid id" }, { status: 400 });
    const log = dbGetLog(id);
    if (!log) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json(maskLog(log, isAdmin), { headers: { "Cache-Control": "no-store" } });
  }

  // GET /api/logs
  const page  = Math.max(1, parseInt(url.searchParams.get("page")  || "1"));
  const limit = Math.min(100, Math.max(10, parseInt(url.searchParams.get("limit") || "25")));
  const nameFilter = url.searchParams.get("user") || "";

  // Resolve name → token_key for DB filter
  const tokenKey = nameFilter
    ? (Object.entries(tokens).find(([, v]) => v.name === nameFilter)?.[0] ?? nameFilter)
    : "";

  const logs  = dbQueryLogs(page, limit, tokenKey);
  const total = dbCountLogs(tokenKey);
  const pages = Math.max(1, Math.ceil(total / limit));

  // Return list of names for the filter dropdown
  const names = dbGetTokenNames();

  return Response.json(
    { logs: logs.map(l => maskLog(l, isAdmin)), total, page, pages, limit, users: names },
    { headers: { "Cache-Control": "no-store" } }
  );
}
