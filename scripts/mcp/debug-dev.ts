#!/usr/bin/env bun
/**
 * MCP Debug Server — proxy-dev
 * Bridge ke runtime local dev (localhost:8080).
 * Tidak butuh auth — hanya untuk local development.
 */

const DEV_URL    = process.env.BASE_URL   ?? "http://localhost:8080";
const MCP_SECRET = process.env.MCP_SECRET ?? "";
const DB_URL     = process.env.DATABASE_URL ?? "";

function log(...a: unknown[]) { process.stderr.write(a.join(" ") + "\n"); }
function send(obj: Record<string, unknown>) { process.stdout.write(JSON.stringify(obj) + "\n"); }

function authHeaders(): Record<string, string> {
  return MCP_SECRET ? { "x-mcp-secret": MCP_SECRET } : {};
}

async function apiGet(path: string): Promise<any> {
  const res = await fetch(`${DEV_URL}${path}`, { headers: authHeaders() });
  if (!res.ok) return { error: `HTTP ${res.status}`, path };
  return res.json();
}

async function apiPost(path: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${DEV_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) return { error: `HTTP ${res.status}`, path };
  return res.json();
}

// ── Tool implementations ──────────────────────────────────────────────────────

async function toolCheckVersion() {
  const data = await apiGet("/api/version");
  return { version: data.version, url: DEV_URL };
}

async function toolCheckStatus(args: { full?: boolean }) {
  const [data, ver] = await Promise.all([apiGet("/api/status"), apiGet("/api/version")]);
  const summary = {
    version: ver.version,
    total_tokens: Object.keys(data.tokens || {}).length,
    paused_tokens: Object.values(data.tokens || {}).filter((t: any) => t.paused).length,
    total_usage_today: Object.values(data.tokens || {}).reduce((s: number, t: any) => s + (t.today || 0), 0),
    upstream_ok: data.upstream?.ok,
    upstream_five_hour: data.upstream?.fiveHour,
    active_provider: data.upstream?.activeProvider,
    alerts: {
      context: (data.contextAlerts || []).length,
      threshold: (data.thresholdAlerts || []).length,
    },
  };
  if (args.full) {
    return { ...summary, tokens: data.tokens, upstream: data.upstream };
  }
  return summary;
}

async function toolCheckLogs(args: {
  limit?: number; status?: number; model?: string; search?: string;
  token?: string; since_minutes?: number; error_only?: boolean;
}) {
  const limit = Math.min(args.limit ?? 50, 200);
  const logs = await apiGet(`/api/logs?limit=${limit}`);
  let entries = logs.logs || [];

  if (args.status)       entries = entries.filter((l: any) => l.status === args.status);
  if (args.model)        entries = entries.filter((l: any) => (l.model || "").includes(args.model));
  if (args.error_only)   entries = entries.filter((l: any) => l.status >= 400);
  if (args.token)        entries = entries.filter((l: any) => (l.token_key || "").endsWith(args.token));
  if (args.since_minutes) {
    const cutoff = Date.now() - args.since_minutes * 60_000;
    entries = entries.filter((l: any) => l.ts > cutoff);
  }
  if (args.search) {
    const q = args.search.toLowerCase();
    entries = entries.filter((l: any) =>
      (l.response_text || "").toLowerCase().includes(q) ||
      (l.prompt || "").toLowerCase().includes(q)
    );
  }

  const compact = entries.slice(0, 50).map((l: any) => ({
    id:           l.id,
    ts:           l.ts,
    age_sec:      Math.round((Date.now() - l.ts) / 1000),
    status:       l.status,
    model:        l.model,
    token:        (l.token_key || "").slice(-6),
    input_tokens: l.input_tokens,
    output_tokens:l.output_tokens,
    duration_ms:  l.duration_ms,
    stream:       l.stream,
    stop_reason:  l.stop_reason,
    prompt:       (l.prompt || "").slice(0, 150),
    response:     (l.response_text || "").slice(0, 300),
  }));

  return { total_matched: entries.length, shown: compact.length, entries: compact };
}

async function toolTailLogs(args: { minutes?: number; token?: string; model?: string; error_only?: boolean }) {
  return toolCheckLogs({ limit: 50, since_minutes: args.minutes ?? 5, ...args });
}

async function toolExplainLog(args: { id: number }) {
  if (!args.id) return { error: "id is required" };
  const d = await apiGet(`/api/logs/${args.id}`);
  if (d.error) return d;
  return {
    id: d.id, ts: d.ts, age_sec: Math.round((Date.now() - d.ts) / 1000),
    name: d.name, model: d.model, status: d.status, stop_reason: d.stop_reason,
    input_tokens: d.input_tokens, output_tokens: d.output_tokens,
    cache_read: d.cache_read, cache_creation: d.cache_creation,
    duration_ms: d.duration_ms, turns: d.turns, tool_use_count: d.tool_use_count,
    stream: d.stream,
    prompt: d.prompt,
    system_prompt: d.system_prompt,
    response_text: (d.response_text || "").slice(0, 2000),
  };
}

async function toolGetTokenDetail(args: { token: string }) {
  if (!args.token) return { error: "token (key suffix) is required" };
  return apiGet(`/api/debug/token/${args.token}`);
}

async function toolCheckQuotaPressure() {
  return apiGet("/api/debug/quota-pressure");
}

async function toolCheckUpstreamHistory() {
  return apiGet("/api/debug/upstream-history");
}

async function toolQueryDb(args: { sql: string }) {
  if (!args.sql) return { error: "sql is required" };
  // Forward ke /api/debug/query yang sudah ada di local server
  return apiPost("/api/debug/query", { sql: args.sql });
}

async function toolQueryPrisma(args: { sql: string }) {
  if (!args.sql) return { error: "sql is required" };
  if (!DB_URL) return { error: "DATABASE_URL not set — cannot query Prisma directly" };
  // Direct PostgreSQL query via Bun's built-in SQL client
  try {
    const { sql } = await import("bun");
    const rows = await sql.unsafe(args.sql);
    return { rows: Array.from(rows) };
  } catch (e: any) {
    return { error: String(e?.message ?? e) };
  }
}

async function toolCheckUsers() {
  // Query users table langsung via debug endpoint
  return toolQueryDb({ sql: "SELECT id, name, email, role, status FROM users ORDER BY created_at DESC LIMIT 20" });
}

async function toolCheckNotifications(args: { limit?: number; include_deleted?: boolean }) {
  const params = new URLSearchParams();
  if (args.limit) params.set("limit", String(args.limit));
  if (args.include_deleted) params.set("include_deleted", "true");
  const q = params.toString();
  return apiGet(`/api/debug/notifications${q ? `?${q}` : ""}`);
}

async function toolCheckSessions() {
  return toolQueryDb({ sql: "SELECT s.id, s.\"userId\", s.\"expiresAt\", s.\"userAgent\", s.\"ipAddress\", u.email FROM session s JOIN \"user\" u ON s.\"userId\" = u.id ORDER BY s.\"createdAt\" DESC LIMIT 10" });
}

// ── Tool registry ─────────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "check_version",
    description: "Get the running version of local dev server.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "check_status",
    description: "Get local dev runtime status: token counts, upstream utilization, alerts. Use full=true for full detail.",
    inputSchema: {
      type: "object",
      properties: {
        full: { type: "boolean", description: "Return full detail including all tokens" },
      },
    },
  },
  {
    name: "check_logs",
    description: "Fetch recent request logs from local dev with filtering. Use to find errors or inspect user activity.",
    inputSchema: {
      type: "object",
      properties: {
        limit:         { type: "number",  description: "Max logs to fetch (default 50, max 200)" },
        status:        { type: "number",  description: "Filter by HTTP status (e.g. 400, 429, 502)" },
        model:         { type: "string",  description: "Filter by model substring" },
        search:        { type: "string",  description: "Search in response_text and prompt" },
        token:         { type: "string",  description: "Filter by last 3-6 chars of token key" },
        since_minutes: { type: "number",  description: "Only entries from last N minutes" },
        error_only:    { type: "boolean", description: "Only show errors (status >= 400)" },
      },
    },
  },
  {
    name: "tail_logs",
    description: "Show recent logs from last N minutes (default 5). Use for real-time debugging.",
    inputSchema: {
      type: "object",
      properties: {
        minutes:    { type: "number",  description: "Look back N minutes (default 5)" },
        token:      { type: "string",  description: "Filter by last 3-8 chars of token key" },
        model:      { type: "string",  description: "Filter by model substring" },
        error_only: { type: "boolean", description: "Only show errors (status >= 400)" },
      },
    },
  },
  {
    name: "explain_log",
    description: "Get full detail of a single request log by ID — includes full prompt, response_text, system_prompt, cache tokens.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Request log ID (from check_logs)" },
      },
      required: ["id"],
    },
  },
  {
    name: "get_token_detail",
    description: "Get full detail for one token: usage, limit, in-flight, daily usage, last requests.",
    inputSchema: {
      type: "object",
      properties: {
        token: { type: "string", description: "Last 3-8 chars of token key" },
      },
      required: ["token"],
    },
  },
  {
    name: "check_quota_pressure",
    description: "Show in-flight reservations + quota headroom per token.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "check_upstream_history",
    description: "Get upstream state (utilization, resets_at, poll age, backoff) from local dev.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "query_db",
    description: "Run a raw SQL query via local dev /api/debug/query endpoint (PostgreSQL). Tables: users, tokens, request_logs, daily_usage, upstream_state, session, account, \"user\".",
    inputSchema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "SQL query (SELECT recommended)" },
      },
      required: ["sql"],
    },
  },
  {
    name: "check_users",
    description: "List all users in the DB (id, name, email, role, status). Use to debug auth/session issues.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "check_sessions",
    description: "List active Better Auth sessions with user email. Use to debug login issues.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "check_notifications",
    description: "List admin broadcast notifications + per-notif dismissal count. Use to verify a broadcast went out and how many users have closed it.",
    inputSchema: {
      type: "object",
      properties: {
        limit:            { type: "number",  description: "Max notifications (default 50, max 200)" },
        include_deleted:  { type: "boolean", description: "Include soft-deleted notifications (default false)" },
      },
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>) {
  switch (name) {
    case "check_version":          return toolCheckVersion();
    case "check_status":           return toolCheckStatus(args);
    case "check_logs":             return toolCheckLogs(args);
    case "tail_logs":              return toolTailLogs(args);
    case "explain_log":            return toolExplainLog(args as { id: number });
    case "get_token_detail":       return toolGetTokenDetail(args as { token: string });
    case "check_quota_pressure":   return toolCheckQuotaPressure();
    case "check_upstream_history": return toolCheckUpstreamHistory();
    case "query_db":               return toolQueryDb(args as { sql: string });
    case "query_prisma":           return toolQueryPrisma(args as { sql: string });
    case "check_users":            return toolCheckUsers();
    case "check_sessions":         return toolCheckSessions();
    case "check_notifications":    return toolCheckNotifications(args as { limit?: number; include_deleted?: boolean });
    default: throw new Error(`Unknown tool: ${name}`);
  }
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
          serverInfo: { name: "proxy-dev", version: "1.0.0" },
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
