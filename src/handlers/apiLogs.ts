import { dbQueryLogs, dbCountLogs, dbGetLog, dbGetTokenNames, tokens, resolveOwnerName } from "../state";

function maskLog(log: any, isAdmin: boolean) {
  return {
    id: log.id, ts: log.ts,
    name: log.name,
    owner_name:    log.owner_name,
    token_label:   log.token_label,
    user_id:       log.user_id,
    token_key:     isAdmin ? log.token_key : log.name,
    model:         log.model,
    input_tokens:  log.input_tokens, output_tokens: log.output_tokens,
    stream:        log.stream, status: log.status,
    stop_reason:   log.stop_reason, duration_ms: log.duration_ms,
    tool_use_count:log.tool_use_count, turns: log.turns,
    messages_json: log.messages_json, response_text: log.response_text,
    prompt:        isAdmin ? log.prompt        : (log.prompt || "").slice(0, 100),
    system_prompt: isAdmin ? log.system_prompt : "",
    cache_read:    isAdmin ? log.cache_read    : 0,
    cache_creation:isAdmin ? log.cache_creation: 0,
  };
}

export async function handleApiLogs(req: Request, url: URL, isAdmin = false): Promise<Response> {
  const parts = url.pathname.split("/").filter(Boolean);

  if (parts.length === 3 && parts[2] !== "") {
    const id = parseInt(parts[2]);
    if (isNaN(id)) return Response.json({ error: "Invalid id" }, { status: 400 });
    const log = await dbGetLog(id);
    if (!log) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json(maskLog(log, isAdmin), { headers: { "Cache-Control": "no-store" } });
  }

  const page       = Math.max(1, parseInt(url.searchParams.get("page")  || "1"));
  const limit      = Math.min(100, Math.max(10, parseInt(url.searchParams.get("limit") || "25")));
  const nameFilter = url.searchParams.get("user") || "";

  // Filter by either owner name, token label, or raw key suffix
  const tokenKey = nameFilter
    ? (Object.entries(tokens).find(([k, v]) =>
        resolveOwnerName(v) === nameFilter || v.label === nameFilter || k === nameFilter
      )?.[0] ?? nameFilter)
    : "";

  const [logs, total, names] = await Promise.all([
    dbQueryLogs(page, limit, tokenKey),
    dbCountLogs(tokenKey),
    dbGetTokenNames(),
  ]);
  const pages = Math.max(1, Math.ceil(total / limit));

  return Response.json(
    { logs: logs.map(l => maskLog(l, isAdmin)), total, page, pages, limit, users: names },
    { headers: { "Cache-Control": "no-store" } }
  );
}
