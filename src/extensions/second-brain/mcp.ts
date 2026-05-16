import { isEnabled } from "../registry";
import { embedText } from "./embedding";
import {
  retrieveRelevantStrategies, markStrategyOutcome, countStrategies,
} from "./strategies";
import { prisma } from "../../prisma";
import { config } from "../../config";

const TOOL_DEFS = [
  {
    name: "recall_strategy",
    description: "Semantically search Second Brain for relevant strategies (mined patterns) given a natural-language query. Returns top-K with title, when_to_use, steps, pitfalls, and similarity score. Use this to recall how past similar tasks were approached.",
    inputSchema: {
      type: "object",
      properties: {
        query:  { type: "string", description: "Natural-language description of the task or pattern you're looking for" },
        limit:  { type: "number", description: "Max strategies to return (default 5, max 20)" },
        scope:  { type: "string", enum: ["user", "shared"], description: "Strategy scope to search (default user)" },
        user_id: { type: "string", description: "User scope filter (default empty = all)" },
      },
      required: ["query"],
    },
  },
  {
    name: "list_patterns",
    description: "List recent strategies in Second Brain, sorted by recency. Use for browsing/auditing patterns rather than semantic search.",
    inputSchema: {
      type: "object",
      properties: {
        limit:    { type: "number", description: "Max entries (default 20, max 100)" },
        user_id:  { type: "string" },
      },
    },
  },
  {
    name: "mark_strategy",
    description: "Provide feedback on a strategy after using it: success / fail / delete. Strategies with high fail rates are auto-pruned periodically.",
    inputSchema: {
      type: "object",
      properties: {
        id:      { type: "string" },
        verdict: { type: "string", enum: ["success", "fail", "delete"] },
      },
      required: ["id", "verdict"],
    },
  },
  {
    name: "brain_stats",
    description: "High-level stats of the Second Brain: strategy count, cache size, recent activity. Use to monitor brain health.",
    inputSchema: { type: "object", properties: {} },
  },
];

function authorized(req: Request): boolean {
  if (!config.mcpSecret) return false;
  const fromHeader = req.headers.get("x-mcp-secret") || "";
  if (fromHeader === config.mcpSecret) return true;
  const auth = req.headers.get("authorization") || "";
  return auth.toLowerCase().startsWith("bearer ") && auth.slice(7).trim() === config.mcpSecret;
}

function jrpcResult(id: any, result: any): Response {
  return Response.json({ jsonrpc: "2.0", id, result }, { headers: { "content-type": "application/json" } });
}
function jrpcError(id: any, code: number, message: string): Response {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message } });
}
function toolText(text: string) {
  return { content: [{ type: "text", text }] };
}

export async function handleMcpSecondBrain(req: Request): Promise<Response> {
  if (req.method === "GET") {
    return Response.json({
      name:    "second-brain",
      version: "1.0.0",
      transport: "http-jsonrpc",
      authentication: "x-mcp-secret header or Authorization: Bearer",
      enabled: isEnabled("second-brain"),
      tools:   TOOL_DEFS.map(t => t.name),
    });
  }
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!authorized(req)) return jrpcError(null, -32001, "Unauthorized");
  if (!isEnabled("second-brain")) return jrpcError(null, -32002, "Second Brain extension is not enabled");

  let body: any;
  try { body = await req.json(); }
  catch { return jrpcError(null, -32700, "Parse error"); }

  const { jsonrpc, id, method, params } = body || {};
  if (jsonrpc !== "2.0") return jrpcError(id, -32600, "Invalid Request");

  if (method === "initialize") {
    return jrpcResult(id, {
      protocolVersion: "2024-11-05",
      capabilities:    { tools: {} },
      serverInfo:      { name: "second-brain", version: "1.0.0" },
    });
  }
  if (method === "tools/list") {
    return jrpcResult(id, { tools: TOOL_DEFS });
  }
  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments || {};
    try {
      if (name === "recall_strategy") return jrpcResult(id, await toolRecallStrategy(args));
      if (name === "list_patterns")   return jrpcResult(id, await toolListPatterns(args));
      if (name === "mark_strategy")   return jrpcResult(id, await toolMarkStrategy(args));
      if (name === "brain_stats")     return jrpcResult(id, await toolBrainStats());
      return jrpcError(id, -32601, "Unknown tool: " + name);
    } catch (e: any) {
      return jrpcError(id, -32603, "Tool error: " + (e?.message ?? String(e)));
    }
  }
  if (method === "ping") return jrpcResult(id, {});
  return jrpcError(id, -32601, "Method not found: " + method);
}

async function toolRecallStrategy(args: any) {
  const query = String(args?.query || "").trim();
  if (!query) throw new Error("query required");
  const limit = Math.min(20, Math.max(1, Number(args?.limit) || 5));
  const scope = (args?.scope === "shared" ? "shared" : "user") as "shared" | "user";
  const userId = String(args?.user_id || "");
  const vec = await embedText(query);
  const strategies = await retrieveRelevantStrategies(vec, userId, scope, limit, 0.4);
  if (!strategies.length) return toolText("No relevant strategies found for this query.");
  const lines: string[] = [`Found ${strategies.length} relevant strategy(ies):\n`];
  strategies.forEach((s, i) => {
    lines.push(`## ${i + 1}. ${s.title}  (sim ${(s.similarity! * 100).toFixed(0)}%, used ${s.use_count}x)`);
    if (s.when_to_use) lines.push(`When to use: ${s.when_to_use}`);
    const steps = safeJson(s.content);
    if (Array.isArray(steps) && steps.length) {
      lines.push("Key steps:");
      steps.forEach((step: string) => lines.push(`  - ${step}`));
    }
    const pitfalls = safeJson(s.pitfalls);
    if (Array.isArray(pitfalls) && pitfalls.length) {
      lines.push("Pitfalls:");
      pitfalls.forEach((p: string) => lines.push(`  - ${p}`));
    }
    lines.push(`(id: ${s.id})\n`);
  });
  return toolText(lines.join("\n"));
}

async function toolListPatterns(args: any) {
  const limit = Math.min(100, Math.max(1, Number(args?.limit) || 20));
  const userId = String(args?.user_id || "");
  const whereClause = userId ? `WHERE user_id = $2` : "";
  const params: any[] = userId ? [limit, userId] : [limit];
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id, title, when_to_use, scope, user_id, use_count, success_count, fail_count, updated_at
       FROM sb_strategies ${whereClause}
       ORDER BY updated_at DESC LIMIT $1`,
    ...params,
  );
  if (!rows.length) return toolText("No strategies in Second Brain yet.");
  const lines = [`${rows.length} strategies (latest first):\n`];
  for (const r of rows) {
    lines.push(`- ${r.title}`);
    lines.push(`    when: ${r.when_to_use?.slice(0, 100)}`);
    lines.push(`    scope=${r.scope} user=${r.user_id || "(any)"} use=${r.use_count} ok=${r.success_count} fail=${r.fail_count}`);
    lines.push(`    id=${r.id}\n`);
  }
  return toolText(lines.join("\n"));
}

async function toolMarkStrategy(args: any) {
  const id = String(args?.id || "");
  const verdict = String(args?.verdict || "");
  if (!id) throw new Error("id required");
  if (verdict === "delete") {
    await prisma.$executeRawUnsafe(`DELETE FROM sb_strategies WHERE id = $1`, id);
    return toolText(`Strategy ${id} deleted.`);
  }
  if (verdict !== "success" && verdict !== "fail") throw new Error("verdict must be success | fail | delete");
  await markStrategyOutcome(id, verdict === "success");
  return toolText(`Marked ${id} as ${verdict}.`);
}

async function toolBrainStats() {
  const total = await countStrategies();
  const cacheRows = await prisma.$queryRawUnsafe<any[]>(`SELECT COUNT(*)::int AS c, COALESCE(SUM(hit_count),0)::int AS hits FROM sb_prompt_cache`);
  const sevenDays = BigInt(Date.now() - 7 * 86400_000);
  const events = await prisma.$queryRawUnsafe<any[]>(
    `SELECT event_type, COUNT(*)::int AS c FROM sb_extension_logs WHERE ts > $1 GROUP BY event_type ORDER BY c DESC`,
    sevenDays,
  );
  const summary = events.map(r => `  ${r.event_type}: ${r.c}`).join("\n");
  return toolText(`Second Brain stats:
  total_strategies: ${total}
  cache_entries:    ${cacheRows[0]?.c || 0}
  cache_total_hits: ${cacheRows[0]?.hits || 0}

Events (7d):
${summary || "  (no activity)"}`);
}

function safeJson(s: string): any {
  try { return JSON.parse(s); } catch { return s; }
}
