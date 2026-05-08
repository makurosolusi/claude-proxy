#!/usr/bin/env bun
/**
 * MCP Debug Server — debug-stg
 * Bridge ke runtime staging: query DB, cek logs, status, dll.
 * Auth via MCP_SECRET → x-mcp-secret header.
 */

const STAGING_URL = process.env.BASE_URL ?? "https://claude-proxy.wibudev.com";
const MCP_SECRET  = process.env.MCP_SECRET  ?? "";

function log(...a: unknown[]) { process.stderr.write(a.join(" ") + "\n"); }
function send(obj: Record<string, unknown>) { process.stdout.write(JSON.stringify(obj) + "\n"); }

async function apiGet(path: string): Promise<any> {
  const res = await fetch(`${STAGING_URL}${path}`, {
    headers: MCP_SECRET ? { "x-mcp-secret": MCP_SECRET } : {},
  });
  return res.json();
}

async function apiPost(path: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${STAGING_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(MCP_SECRET ? { "x-mcp-secret": MCP_SECRET } : {}),
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

// ── Tool implementations ──────────────────────────────────────────────────────

async function toolCheckVersion() {
  const data = await apiGet("/api/version");
  return { version: data.version, url: STAGING_URL };
}

async function toolCheckStatus(args: { full?: boolean }) {
  const data = await apiGet("/api/status");
  const full = args.full ?? false;

  // Summary mode: just counts + upstream
  const summary = {
    version: (await apiGet("/api/version")).version,
    total_tokens: Object.keys(data.tokens || {}).length,
    paused_tokens: Object.values(data.tokens || {}).filter((t: any) => t.paused).length,
    total_usage_today: Object.values(data.tokens || {}).reduce((s: number, t: any) => s + (t.today || 0), 0),
    upstream_ok: data.upstream?.ok,
    upstream_five_hour: data.upstream?.fiveHour,
    fallback_provider: data.upstream?.fallbackProvider,
    active_provider: data.upstream?.activeProvider,
    alerts: {
      context: (data.contextAlerts || []).length,
      threshold: (data.thresholdAlerts || []).length,
    },
  };

  if (full) {
    return {
      ...summary,
      tokens: data.tokens,
      upstream: data.upstream,
      context_alerts: data.contextAlerts?.slice(0, 5),
      threshold_alerts: data.thresholdAlerts?.slice(0, 10),
      model_routes: data.modelRoutes,
    };
  }
  return summary;
}

async function toolCheckLogs(args: {
  limit?: number; status?: number; model?: string; search?: string;
  token?: string; since_minutes?: number; error_only?: boolean;
}) {
  const limit = args.limit ?? 50;
  const logs = await apiGet(`/api/logs?limit=${Math.min(limit, 200)}`);

  let entries = logs.logs || [];
  if (args.status) entries = entries.filter((l: any) => l.status === args.status);
  if (args.model) entries = entries.filter((l: any) => (l.model || "").includes(args.model));
  if (args.search) {
    const q = args.search.toLowerCase();
    entries = entries.filter((l: any) =>
      (l.response_text || "").toLowerCase().includes(q) ||
      (l.prompt || "").toLowerCase().includes(q)
    );
  }
  if (args.token) entries = entries.filter((l: any) => (l.token_key || "").endsWith(args.token));
  if (args.since_minutes) {
    const cutoff = Date.now() - args.since_minutes * 60_000;
    entries = entries.filter((l: any) => l.ts > cutoff);
  }
  if (args.error_only) entries = entries.filter((l: any) => l.status >= 400);

  // Compact format for AI consumption
  const compact = entries.slice(0, 30).map((l: any) => ({
    ts: l.ts,
    age_sec: Math.round((Date.now() - l.ts) / 1000),
    status: l.status,
    model: l.model,
    token: (l.token_key || "").slice(-6),
    input_tokens: l.input_tokens,
    output_tokens: l.output_tokens,
    duration_ms: l.duration_ms,
    stream: l.stream,
    stop_reason: l.stop_reason,
    prompt: (l.prompt || "").slice(0, 150),
    response: (l.response_text || "").slice(0, 300),
  }));

  return {
    total_matched: entries.length,
    shown: compact.length,
    entries: compact,
  };
}

async function toolQueryDb(args: { sql: string }) {
  if (!args.sql) return { error: "sql is required" };
  return apiPost("/api/debug/query", { sql: args.sql });
}

// ── Tool registry ─────────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "query_db",
    description:
      "Run a read-only SQL query on the staging SQLite database. " +
      "Tables: tokens, users, request_logs, daily_usage, upstream_state, admin_sessions, settings. " +
      "Examples: SELECT * FROM request_logs WHERE status >= 400 ORDER BY ts DESC LIMIT 10; " +
      "SELECT key, name, used, lim, paused FROM tokens ORDER BY used DESC; " +
      "PRAGMA table_info(request_logs);",
    inputSchema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "Read-only SQL query (SELECT or safe PRAGMA only)" },
      },
      required: ["sql"],
    },
  },
  {
    name: "check_logs",
    description:
      "Fetch recent request logs from staging with filtering. " +
      "Use to find errors, inspect specific user activity, or search for patterns.",
    inputSchema: {
      type: "object",
      properties: {
        limit:        { type: "number", description: "Max logs to fetch (default 50, max 200)" },
        status:       { type: "number", description: "Filter by HTTP status (e.g. 400, 429, 502)" },
        model:        { type: "string", description: "Filter by model substring (e.g. deepseek, claude)" },
        search:       { type: "string", description: "Search in response_text and prompt" },
        token:        { type: "string", description: "Filter by last 3-6 chars of token key" },
        since_minutes:{ type: "number", description: "Only entries from last N minutes" },
        error_only:   { type: "boolean", description: "Only show errors (status >= 400)" },
      },
    },
  },
  {
    name: "check_status",
    description:
      "Get staging runtime status: token counts, upstream utilization, active provider, alerts. " +
      "Use full=true to get detailed token list and upstream info.",
    inputSchema: {
      type: "object",
      properties: {
        full: { type: "boolean", description: "Return full detail including all tokens (default: summary)" },
      },
    },
  },
  {
    name: "check_version",
    description: "Get the currently deployed version on staging.",
    inputSchema: { type: "object", properties: {} },
  },
];

async function callTool(name: string, args: Record<string, unknown>) {
  if (name === "query_db")      return toolQueryDb(args as { sql: string });
  if (name === "check_logs")    return toolCheckLogs(args);
  if (name === "check_status")  return toolCheckStatus(args);
  if (name === "check_version") return toolCheckVersion();
  throw new Error(`Unknown tool: ${name}`);
}

// ── JSON-RPC 2.0 stdio transport ──────────────────────────────────────────────
let buf = "";
process.stdin.setEncoding("utf8");

process.stdin.on("data", (chunk: string) => {
  buf += chunk;
  const lines = buf.split("\n");
  buf = lines.pop() ?? "";
  for (const line of lines) {
    const t = line.trim();
    if (t) void handleMessage(t);
  }
});
process.stdin.on("end", () => process.exit(0));

async function handleMessage(raw: string) {
  let req: { jsonrpc: string; id: unknown; method: string; params?: Record<string, unknown> };
  try { req = JSON.parse(raw); }
  catch { return; }

  const { id, method, params } = req;
  try {
    let result: unknown;
    switch (method) {
      case "initialize":
        result = {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "debug-stg", version: "1.0.0" },
        };
        break;
      case "notifications/initialized":
        return;
      case "ping":
        result = {};
        break;
      case "tools/list":
        result = { tools: TOOLS };
        break;
      case "tools/call": {
        const name = String(params?.name ?? "");
        const args = (params?.arguments ?? {}) as Record<string, unknown>;
        const output = await callTool(name, args);
        result = { content: [{ type: "text", text: JSON.stringify(output, null, 2) }] };
        break;
      }
      default:
        send({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
        return;
    }
    send({ jsonrpc: "2.0", id, result });
  } catch (e: any) {
    log(`[error] method=${method}: ${e.message}`);
    send({ jsonrpc: "2.0", id, error: { code: -32603, message: String(e?.message ?? e) } });
  }
}
