import { config } from "../config";
import { db }     from "../state";

function checkMcpSecret(req: Request): boolean {
  if (!config.mcpSecret) return false;
  const token = req.headers.get("x-mcp-secret") || req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return token === config.mcpSecret;
}

export function handleDebugQuery(req: Request): Response {
  if (!checkMcpSecret(req)) {
    return Response.json({ error: "Unauthorized — invalid or missing MCP_SECRET" }, { status: 401 });
  }
  let sql = "";
  try {
    const body = req.body;
    if (!body) return Response.json({ error: "Missing request body" }, { status: 400 });
    // Read body as text — Bun supports this on Request
    return (async () => {
      try {
        const raw = await req.text();
        let parsed: any;
        try { parsed = JSON.parse(raw); } catch { sql = raw.trim(); }
        if (parsed) sql = String(parsed.sql || parsed.query || "").trim();
        if (!sql) return Response.json({ error: "Empty query" }, { status: 400 });

        // Safety: only allow read operations
        const clean = sql.trim().toUpperCase();
        const dangerous = /^(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|REPLACE|ATTACH|DETACH|REINDEX|VACUUM|PRAGMA\s+(?!table_info|table_xinfo|index_list|index_info|foreign_key_list|compile_options|database_list|page_count|page_size|quick_check|integrity_check))/i;
        if (dangerous.test(clean)) {
          return Response.json({ error: "Only read queries (SELECT, PRAGMA table_info, etc.) are allowed" }, { status: 403 });
        }

        const start = performance.now();
        const rows = db.query(sql).all();
        const elapsed = Math.round((performance.now() - start) * 100) / 100;
        return Response.json({ ok: true, elapsed_ms: elapsed, row_count: rows.length, rows });
      } catch (e: any) {
        return Response.json({ ok: false, error: String(e.message ?? e) }, { status: 422 });
      }
    })() as any;
  } catch (e: any) {
    return Response.json({ ok: false, error: String(e.message ?? e) }, { status: 422 });
  }
}
