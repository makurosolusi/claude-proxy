import { sql } from "drizzle-orm";
import { config } from "../config";
import { db }     from "../db";

function checkMcpSecret(req: Request): boolean {
  if (!config.mcpSecret) return false;
  const token = req.headers.get("x-mcp-secret") || req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return token === config.mcpSecret;
}

export async function handleDebugQuery(req: Request): Promise<Response> {
  if (!checkMcpSecret(req)) {
    return Response.json({ error: "Unauthorized — invalid or missing MCP_SECRET" }, { status: 401 });
  }
  try {
    const raw = await req.text();
    let querySql = "";
    try { querySql = String(JSON.parse(raw)?.sql || JSON.parse(raw)?.query || "").trim(); }
    catch { querySql = raw.trim(); }
    if (!querySql) return Response.json({ error: "Empty query" }, { status: 400 });

    // Safety: only allow read operations
    const clean = querySql.trim().toUpperCase();
    const dangerous = /^(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|REPLACE|ATTACH|DETACH|REINDEX|VACUUM)/i;
    if (dangerous.test(clean)) {
      return Response.json({ error: "Only SELECT queries are allowed" }, { status: 403 });
    }

    const start = performance.now();
    const result = await db.execute(sql.raw(querySql));
    const elapsed = Math.round((performance.now() - start) * 100) / 100;
    const rows = (result as any).rows ?? result;
    return Response.json({ ok: true, elapsed_ms: elapsed, row_count: rows.length, rows });
  } catch (e: any) {
    return Response.json({ ok: false, error: String(e.message ?? e) }, { status: 422 });
  }
}
