#!/usr/bin/env bun
/**
 * MCP Debug Server — proxy-stg
 * Bridge ke runtime staging: query DB, cek logs, status, dll.
 * Auth via MCP_SECRET → x-mcp-secret header.
 */

const STAGING_URL      = process.env.BASE_URL          ?? "https://claude-proxy.wibudev.com";
const MCP_SECRET       = process.env.MCP_SECRET        ?? "";
const DEV_LOGIN_SECRET = process.env.DEV_LOGIN_SECRET  ?? "";

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

async function toolTailLogs(args: { minutes?: number; token?: string; model?: string; error_only?: boolean }) {
  const minutes = args.minutes ?? 5;
  return toolCheckLogs({
    limit: 50,
    since_minutes: minutes,
    token: args.token,
    model: args.model,
    error_only: args.error_only,
  });
}

async function toolExplainLog(args: { id: number }) {
  if (!args.id) return { error: "id is required" };
  const data = await apiGet(`/api/logs/${args.id}`);
  if (data.error) return data;
  return {
    id:            data.id,
    ts:            data.ts,
    age_sec:       Math.round((Date.now() - data.ts) / 1000),
    name:          data.name,
    model:         data.model,
    status:        data.status,
    stop_reason:   data.stop_reason,
    input_tokens:  data.input_tokens,
    output_tokens: data.output_tokens,
    cache_read:    data.cache_read,
    cache_creation:data.cache_creation,
    duration_ms:   data.duration_ms,
    turns:         data.turns,
    tool_use_count:data.tool_use_count,
    stream:        data.stream,
    prompt:        data.prompt,
    system_prompt: data.system_prompt,
    response_text: (data.response_text || "").slice(0, 2000),
  };
}

async function toolGetTokenDetail(args: { token: string }) {
  if (!args.token) return { error: "token (key suffix) is required" };
  return apiGet(`/api/debug/token/${args.token}`);
}

async function toolCheckUpstreamHistory() {
  return apiGet("/api/debug/upstream-history");
}

async function toolCheckQuotaPressure() {
  return apiGet("/api/debug/quota-pressure");
}

async function toolTailConsole(args: { lines?: number; level?: "info" | "warn" | "error"; since_minutes?: number }) {
  const params = new URLSearchParams();
  if (args.lines)         params.set("lines", String(args.lines));
  if (args.level)         params.set("level", args.level);
  if (args.since_minutes) params.set("since_minutes", String(args.since_minutes));
  return apiGet(`/api/debug/console?${params.toString()}`);
}

async function toolCheckRuntime() {
  return apiGet("/api/debug/runtime");
}

async function toolCheckUsers() {
  return apiGet("/api/debug/users");
}

async function toolCheckSettings() {
  return apiGet("/api/debug/settings");
}

async function toolCheckProxyErrors(args: { minutes?: number }) {
  const minutes = args.minutes ?? 60;
  return apiGet(`/api/debug/proxy-errors?minutes=${minutes}`);
}

async function toolCheckSyncTokens() {
  return apiGet("/api/debug/sync-tokens");
}

async function toolCheckCredits(args: { provider: string }) {
  if (!args.provider) return { error: "provider is required (deepseek | openrouter)" };
  return apiGet(`/api/debug/credits/${args.provider}`);
}

async function toolCheckWs() {
  return apiGet("/api/debug/ws");
}

async function toolCheckExtensions() {
  return apiGet("/api/debug/extensions");
}

async function toolCheckBrainOverview() {
  return apiGet("/api/debug/brain/overview");
}

async function toolCheckBrainStrategies(args: { limit?: number; q?: string }) {
  const params = new URLSearchParams();
  if (args.limit) params.set("limit", String(args.limit));
  if (args.q)     params.set("q", args.q);
  return apiGet(`/api/debug/brain/strategies?${params.toString()}`);
}

async function toolCheckBrainQueue() {
  return apiGet("/api/debug/brain/queue");
}

async function toolCheckDbSize() {
  return apiGet("/api/debug/db-size");
}

async function toolCheckSessionsSummary() {
  return apiGet("/api/debug/sessions-summary");
}

async function toolDevLogin(args: { email: string; name?: string }) {
  if (!DEV_LOGIN_SECRET) {
    return { error: "DEV_LOGIN_SECRET not configured in MCP env. Set it in .mcp.json to enable this tool." };
  }
  const res = await fetch(`${STAGING_URL}/api/dev/login`, {
    method:  "POST",
    headers: { "content-type": "application/json", "x-dev-secret": DEV_LOGIN_SECRET },
    body:    JSON.stringify({ email: args.email, name: args.name }),
  });
  if (!res.ok) {
    const text = await res.text();
    return { error: `HTTP ${res.status}`, body: text.slice(0, 200) };
  }
  const data = await res.json() as any;
  return {
    user: data.user,
    playwright_cookies: [{
      name:     data.cookie.name,
      value:    data.cookie.value,
      domain:   data.cookie.domain,
      path:     data.cookie.path,
      httpOnly: data.cookie.httpOnly,
      secure:   data.cookie.secure,
      sameSite: data.cookie.sameSite,
      expires:  data.cookie.expires,
    }],
    cookie_header: `${data.cookie.name}=${data.cookie.value}`,
    hint: "Next: inject playwright_cookies via browser_run_code_unsafe → page.context().addCookies(...), then browser_navigate to a protected route.",
  };
}

async function toolCheckNotifications(args: { limit?: number; include_deleted?: boolean }) {
  const params = new URLSearchParams();
  if (args.limit) params.set("limit", String(args.limit));
  if (args.include_deleted) params.set("include_deleted", "true");
  const q = params.toString();
  return apiGet(`/api/debug/notifications${q ? `?${q}` : ""}`);
}

async function toolCheckTokenModels(args: { limit?: number; key?: string; mode?: string }) {
  const params = new URLSearchParams();
  if (args.limit) params.set("limit", String(args.limit));
  if (args.key) params.set("key", args.key);
  if (args.mode) params.set("mode", args.mode);
  const q = params.toString();
  return apiGet(`/api/debug/token-models${q ? `?${q}` : ""}`);
}

async function toolCheckAnthropicAccounts() {
  return apiGet("/api/debug/anthropic-accounts");
}

async function toolCheckTestUpstream(args: { provider: string }) {
  if (!args.provider) return { error: "provider is required (anthropic|deepseek|openrouter|<custom-id>)" };
  return apiGet(`/api/debug/test-upstream/${encodeURIComponent(args.provider)}`);
}

async function toolCheckActiveProviders(args: { minutes?: number }) {
  const minutes = args.minutes ?? 60;
  return apiGet(`/api/debug/active-providers?minutes=${minutes}`);
}

async function toolCheckAppLogs(args: {
  level?: string; source?: string; q?: string; since_minutes?: number; limit?: number;
}) {
  const params = new URLSearchParams();
  if (args.level)         params.set("level", args.level);
  if (args.source)        params.set("source", args.source);
  if (args.q)             params.set("q", args.q);
  if (args.since_minutes) params.set("since_minutes", String(args.since_minutes));
  if (args.limit)         params.set("limit", String(args.limit));
  return apiGet(`/api/debug/app-logs?${params.toString()}`);
}

async function toolTailAppLogs(args: { minutes?: number; level?: string; source?: string; q?: string }) {
  const minutes = args.minutes ?? 5;
  return toolCheckAppLogs({
    level:  args.level,
    source: args.source,
    q:      args.q,
    since_minutes: minutes,
    limit: 200,
  });
}

async function toolCheckAppLogsStats(args: { since_hours?: number }) {
  const hours = args.since_hours ?? 24;
  return apiGet(`/api/debug/app-logs/stats?since_hours=${hours}`);
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
  {
    name: "tail_logs",
    description:
      "Show recent logs from the last N minutes (default 5). " +
      "Use for real-time debugging when a user reports an issue right now.",
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
    description:
      "Get full detail of a single request log by ID — includes full prompt, response_text, system_prompt, cache tokens. " +
      "Use to reproduce a bug from a specific request.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Request log ID (from check_logs or query_db)" },
      },
      required: ["id"],
    },
  },
  {
    name: "get_token_detail",
    description:
      "Get full detail for one token: usage, limit, in-flight, 7-day daily usage, and last 20 requests. " +
      "Pass the last 3-8 chars of the token key.",
    inputSchema: {
      type: "object",
      properties: {
        token: { type: "string", description: "Last 3-8 chars of token key" },
      },
      required: ["token"],
    },
  },
  {
    name: "check_upstream_history",
    description:
      "Get upstream state (utilization, resets_at, poll age, backoff) plus proxy error distribution from last 24h. " +
      "Use to diagnose why requests failed at a specific time.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "check_quota_pressure",
    description:
      "Show in-flight reservations + quota headroom per token. " +
      "Use when quota seems exhausted despite low .used values — in-flight may be consuming the remaining quota.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "tail_console",
    description:
      "Read in-memory ring buffer of recent stdout/stderr from the running app — " +
      "captures uncaughtException stack traces, [proxy], [upstream] log lines etc. " +
      "Filter by level=error to see only errors. Use right after a crash report.",
    inputSchema: {
      type: "object",
      properties: {
        lines:         { type: "number", description: "Max lines to return (default 100, max 500)" },
        level:         { type: "string", enum: ["info", "warn", "error"], description: "Filter by log level" },
        since_minutes: { type: "number", description: "Only entries from last N minutes" },
      },
    },
  },
  {
    name: "check_runtime",
    description:
      "Process runtime snapshot: memory (rss/heap), uptime, in-memory state sizes " +
      "(tokens/users/recent_logs/ws/in_flight), error counters, upstream poll state. " +
      "Use to diagnose memory pressure or hanging state without SSH.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "check_users",
    description:
      "User summary: id, name, email, role, status, token_count, today/alltime usage. " +
      "Also lists orphan tokens (user_id unset or pointing to deleted user).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "check_settings",
    description:
      "Runtime config dump from settings table. API keys + sync tokens are masked. " +
      "Also reports which keys come from env overrides.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "check_proxy_errors",
    description:
      "Group recent proxy errors (status >= 400) by (status + first 80 chars of response_text). " +
      "Returns count, last_age_sec, and sample request IDs per group. " +
      "Use to spot recurring failure modes quickly.",
    inputSchema: {
      type: "object",
      properties: {
        minutes: { type: "number", description: "Look back N minutes (default 60, max 1440)" },
      },
    },
  },
  {
    name: "check_sync_tokens",
    description:
      "List active DB sync tokens (used by /api/admin/db/sync). " +
      "Returns full token string + creation time + age — for revoking stale ones.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "check_credits",
    description:
      "Live credit balance from DeepSeek or OpenRouter. " +
      "Returns total/used/remaining + (DS only) granted/topped_up breakdown.",
    inputSchema: {
      type: "object",
      properties: {
        provider: { type: "string", enum: ["deepseek", "openrouter"], description: "Which provider to query" },
      },
      required: ["provider"],
    },
  },
  {
    name: "check_ws",
    description:
      "WebSocket connection diagnostics: total connected clients (admin vs public), " +
      "oldest connection age. Useful when broadcast spikes CPU.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "check_extensions",
    description:
      "List all registered extensions (id, name, enabled state, masked config). " +
      "Use to verify which extensions are currently active on staging.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "check_brain_overview",
    description:
      "Second Brain extension overview: cache hit rate (7d), entries, expired count, " +
      "strategy total, mining/injection stats, top strategies by use_count, event counts. " +
      "Returns 409 if extension never enabled (sb_* tables missing).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "check_brain_strategies",
    description:
      "List or vector-search Second Brain strategies. " +
      "Without `q`, returns most-recently-updated. With `q`, returns top results by cosine similarity.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max rows (default 20, max 50)" },
        q:     { type: "string", description: "Optional semantic query — runs vector search" },
      },
    },
  },
  {
    name: "check_brain_queue",
    description:
      "Inspect pg-boss worker queue (sb_pgboss schema): active jobs by name+state, " +
      "24h archive (completed/failed counts), oldest pending. " +
      "Use to diagnose stuck mining workers.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "check_db_size",
    description:
      "Top 25 Postgres tables by total size (data + indexes) with row estimates, " +
      "plus total database size. Use for capacity planning and abnormal-growth detection.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "check_sessions_summary",
    description:
      "Claude Code session counts per user. " +
      "Use to see who is actively running sessions on staging.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "check_notifications",
    description:
      "List admin broadcast notifications + per-notif dismissal counts on staging. " +
      "Use to verify a broadcast went out and how many users have closed it.",
    inputSchema: {
      type: "object",
      properties: {
        limit:           { type: "number",  description: "Max notifications (default 50, max 200)" },
        include_deleted: { type: "boolean", description: "Include soft-deleted notifications (default false)" },
      },
    },
  },
  {
    name: "check_token_models",
    description:
      "Inspect per-token model allowlists (tokens.allowed_models) on staging: which tokens have a multi-model allowlist, " +
      "which are still a single pin, which are unrestricted. Returns aggregate counts per mode plus per-token allowed_models " +
      "in priority order (index 0 = redirect target). Token keys are masked.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max tokens (default 50, max 200)" },
        key:   { type: "string", description: "Filter by token key suffix (e.g. last 6 chars) — full key not needed" },
        mode:  { type: "string", enum: ["unrestricted", "pinned", "multi"], description: "Filter by allowlist mode: unrestricted (0 models), pinned (1), multi (2+)" },
      },
    },
  },
  {
    name: "check_anthropic_accounts",
    description:
      "List Claude OAuth accounts (claude-*.json) on staging: which is pinned via " +
      "settings.anthropic_account, which is actually serving, and whether a pin is " +
      "being fallen back on. No token values returned.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "dev_login",
    description:
      "Login as a user via dev backdoor on staging (skips Google OAuth). Returns Playwright-ready cookies. " +
      "CALL THIS BEFORE mcp__playwright__browser_navigate to any protected route (/, /admin, /profile) — " +
      "Google OAuth cannot be automated by Playwright. Auto-creates the user with approved status if not exists. " +
      "Requires DEV_LOGIN_SECRET env var (set in .mcp.json) AND staging must have DEV_LOGIN_SECRET configured.",
    inputSchema: {
      type: "object",
      properties: {
        email: { type: "string", description: "Email to login as. Auto-created on first call with approved status + default token." },
        name:  { type: "string", description: "Optional display name (defaults to email local-part)" },
      },
      required: ["email"],
    },
  },
  {
    name: "check_test_upstream",
    description:
      "Live probe upstream connectivity by sending a tiny test request. " +
      "provider: anthropic | deepseek | openrouter | <custom-provider-id>. " +
      "Returns { ok, latency, detail|error }.",
    inputSchema: {
      type: "object",
      properties: {
        provider: { type: "string", description: "anthropic | deepseek | openrouter | custom slug" },
      },
      required: ["provider"],
    },
  },
  {
    name: "check_active_providers",
    description:
      "Recent request distribution by model + status. " +
      "Returns totals (requests, errors, streamed), per-model breakdown (requests, tokens, avg duration), " +
      "and status code distribution. Use for routing/health sanity check.",
    inputSchema: {
      type: "object",
      properties: {
        minutes: { type: "number", description: "Look back N minutes (default 60, max 1440)" },
      },
    },
  },
  {
    name: "check_app_logs",
    description:
      "Read persisted application logs from app_logs table (log-management extension). " +
      "Filter by level/source/text/time. Survives restarts unlike tail_console (memory buffer). " +
      "Returns 409 if extension never enabled.",
    inputSchema: {
      type: "object",
      properties: {
        level:         { type: "string", enum: ["info", "warn", "error"], description: "Filter by log level" },
        source:        { type: "string", description: "Filter by source (e.g. 'upstream', 'proxy', 'second-brain')" },
        q:             { type: "string", description: "Substring search in message (case-insensitive)" },
        since_minutes: { type: "number", description: "Only entries from last N minutes" },
        limit:         { type: "number", description: "Max rows (default 100, max 500)" },
      },
    },
  },
  {
    name: "tail_app_logs",
    description:
      "Show app_logs entries from the last N minutes (default 5) with optional level/source/text filters. " +
      "Higher-fidelity than tail_console because data persists in DB.",
    inputSchema: {
      type: "object",
      properties: {
        minutes: { type: "number", description: "Look back N minutes (default 5)" },
        level:   { type: "string", enum: ["info", "warn", "error"] },
        source:  { type: "string", description: "Filter by source" },
        q:       { type: "string", description: "Substring search in message" },
      },
    },
  },
  {
    name: "check_app_logs_stats",
    description:
      "Aggregate stats from app_logs: counts by level, top sources, oldest entry, total in DB. " +
      "Use to understand retention coverage and where most logs originate.",
    inputSchema: {
      type: "object",
      properties: {
        since_hours: { type: "number", description: "Aggregation window in hours (default 24, max 168)" },
      },
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>) {
  if (name === "query_db")               return toolQueryDb(args as { sql: string });
  if (name === "check_logs")             return toolCheckLogs(args);
  if (name === "check_status")           return toolCheckStatus(args);
  if (name === "check_version")          return toolCheckVersion();
  if (name === "tail_logs")              return toolTailLogs(args);
  if (name === "explain_log")            return toolExplainLog(args as { id: number });
  if (name === "get_token_detail")       return toolGetTokenDetail(args as { token: string });
  if (name === "check_upstream_history") return toolCheckUpstreamHistory();
  if (name === "check_quota_pressure")   return toolCheckQuotaPressure();
  if (name === "tail_console")           return toolTailConsole(args);
  if (name === "check_runtime")          return toolCheckRuntime();
  if (name === "check_users")            return toolCheckUsers();
  if (name === "check_settings")         return toolCheckSettings();
  if (name === "check_proxy_errors")     return toolCheckProxyErrors(args);
  if (name === "check_sync_tokens")      return toolCheckSyncTokens();
  if (name === "check_credits")          return toolCheckCredits(args as { provider: string });
  if (name === "check_ws")               return toolCheckWs();
  if (name === "check_extensions")       return toolCheckExtensions();
  if (name === "check_brain_overview")   return toolCheckBrainOverview();
  if (name === "check_brain_strategies") return toolCheckBrainStrategies(args as { limit?: number; q?: string });
  if (name === "check_brain_queue")      return toolCheckBrainQueue();
  if (name === "check_db_size")          return toolCheckDbSize();
  if (name === "check_sessions_summary") return toolCheckSessionsSummary();
  if (name === "check_test_upstream")    return toolCheckTestUpstream(args as { provider: string });
  if (name === "check_active_providers") return toolCheckActiveProviders(args);
  if (name === "check_app_logs")         return toolCheckAppLogs(args);
  if (name === "tail_app_logs")          return toolTailAppLogs(args);
  if (name === "check_app_logs_stats")   return toolCheckAppLogsStats(args);
  if (name === "check_notifications")    return toolCheckNotifications(args as { limit?: number; include_deleted?: boolean });
  if (name === "check_token_models")     return toolCheckTokenModels(args as { limit?: number; key?: string; mode?: string });
  if (name === "check_anthropic_accounts") return toolCheckAnthropicAccounts();
  if (name === "dev_login")              return toolDevLogin(args as { email: string; name?: string });
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
          serverInfo: { name: "proxy-stg", version: "1.0.0" },
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
