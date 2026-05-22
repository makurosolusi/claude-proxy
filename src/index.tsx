import { serve, type ServerWebSocket } from "bun";
import fs from "node:fs";
import path from "node:path";

const APP_VERSION: string = JSON.parse(
  fs.readFileSync(path.join(import.meta.dir, "../package.json"), "utf8")
).version;
import { config }           from "./config";
import { prisma }           from "./prisma";
import { loadFromDb, backfillUsers, onShutdown, tokens, users, upstream, dailyUsage, totalTokensAllTime, allTimePerUser, dbSetUserRole, dbSetUserStatus, dbSaveSetting, settings, resolveTokenName } from "./state";
import { initFromEnv, todayKey, maskToken } from "./tokens";
import { startPoller }     from "./upstream";
import { startMaintenanceScheduler, pruneRequestLogs } from "./maintenance";
import { handleApiStatus, buildTokenData } from "./handlers/apiStatus";
import { handleApiLogs }   from "./handlers/apiLogs";
import { handleApiStats }  from "./handlers/apiStats";
import { handleApiMind }   from "./handlers/apiMind";
import { handleApiRace }         from "./handlers/apiRace";
import { handleApiUsageHourly }  from "./handlers/apiUsageHourly";
import { handleApiSessions, handleApiSessionsSummary } from "./handlers/apiSessions";
import { handleApiAnalytics }    from "./handlers/apiAnalytics";
import { handleApiUserActivity } from "./handlers/apiUserActivity";
import { handleApiCompetition }  from "./handlers/apiCompetition";
import { handleApiTest }   from "./handlers/apiTest";
import { handleDeepSeekTest, handleOpenRouterTest, handleCustomProviderTest } from "./handlers/apiTestProviders";
import { handleAuthStart, handleAuthExchange, handleAuthStatus, handleAuthRemove, handleAuthImport } from "./handlers/apiAuth";
import { handleDebugQuery } from "./handlers/apiDebug";
import {
  handleDebugToken, handleDebugUpstreamHistory, handleDebugQuotaPressure,
  handleDebugConsole, handleDebugRuntime, handleDebugUsers, handleDebugSettings,
  handleDebugProxyErrors, handleDebugSyncTokens, handleDebugCredits,
} from "./handlers/apiDebugExtra";
import {
  handleDebugExtensions, handleDebugBrainOverview, handleDebugBrainStrategies,
  handleDebugBrainQueue, handleDebugDbSize,
  handleDebugSessionsSummary, handleDebugTestUpstream, handleDebugActiveProviders,
  handleDebugAppLogs, handleDebugAppLogsStats,
} from "./handlers/apiDebugBrain";
import { handleDebugNotifications } from "./handlers/apiDebugNotifications";
import { handleAdmin }     from "./handlers/admin";
import { handleApiUsers }  from "./handlers/apiUsers";
import { handleApiModels } from "./handlers/apiModels";
import { handleApiCredits } from "./handlers/apiCredits";
import { handleApiCustomProviders } from "./handlers/apiCustomProviders";
import { generateSyncToken, listSyncTokens, revokeSyncToken, handleDbExport, handleDbSync, loadSyncTokens } from "./handlers/apiDbSync";
import { handleProxy }     from "./handlers/proxy";
import { handleDevLogin }  from "./handlers/apiDevLogin";
import { handleApiExtensions } from "./handlers/apiExtensions";
import { bootstrapExtensions } from "./extensions";
import { handleSecondBrainAdmin } from "./extensions/second-brain/admin-api";
import { handleLogManagementAdmin } from "./extensions/log-management/admin-api";
import { handleMcpSecondBrain } from "./extensions/second-brain/mcp";
import { auth } from "./auth";
import { _broadcast, _broadcastSystemMsg, _broadcastNotifChanged, triggerBroadcast } from "./broadcast";
import {
  handleAdminCreateNotification, handleAdminListNotifications, handleAdminDeleteNotification,
  handleUserPendingNotifications, handleUserDismissNotification,
} from "./handlers/apiNotifications";
import { installConsoleInterceptor, recordUncaught, recordUnhandled } from "./consoleBuffer";

// ── Console interceptor + global error handlers ──────────────────────────────
// Install ring buffer first so error logs are captured by /api/debug/console.
// Then attach handlers that record + log without exiting the process.
installConsoleInterceptor();
process.on("uncaughtException", (err: Error) => {
  recordUncaught(err);
  console.error("[uncaughtException]", err?.stack || err);
});
process.on("unhandledRejection", (reason: unknown) => {
  recordUnhandled(reason);
  if (reason instanceof Error) {
    console.error("[unhandledRejection]", reason.stack || reason);
  } else {
    console.error("[unhandledRejection]", reason, "type=" + typeof reason);
  }
});

// ── Startup migrations (idempotent, IF NOT EXISTS) ───────────────────────────
{
  const migrations = [
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS context_blocked_at BIGINT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS context_block_reason TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS context_block_grace_until BIGINT`,
    `CREATE TABLE IF NOT EXISTS admin_notifications (
      id TEXT PRIMARY KEY,
      message TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      created_by TEXT NOT NULL DEFAULT '',
      target_type TEXT NOT NULL DEFAULT 'all',
      target_ids TEXT NOT NULL DEFAULT '',
      deleted BOOLEAN NOT NULL DEFAULT FALSE
    )`,
    `CREATE INDEX IF NOT EXISTS idx_admin_notif_active ON admin_notifications (deleted, created_at DESC)`,
    `CREATE TABLE IF NOT EXISTS notification_dismissals (
      notification_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      dismissed_at BIGINT NOT NULL,
      PRIMARY KEY (notification_id, user_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_notif_dismiss_user ON notification_dismissals (user_id)`,
    `ALTER TABLE admin_notifications ADD COLUMN IF NOT EXISTS deliver_via TEXT NOT NULL DEFAULT 'web'`,
    `ALTER TABLE admin_notifications ADD COLUMN IF NOT EXISTS priority    TEXT NOT NULL DEFAULT 'info'`,
    `CREATE TABLE IF NOT EXISTS notification_terminal_deliveries (
      notification_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      delivered_at BIGINT NOT NULL,
      PRIMARY KEY (notification_id, user_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_notif_term_user ON notification_terminal_deliveries (user_id)`,
  ];
  for (const sql of migrations) {
    await prisma.$executeRawUnsafe(sql).catch(e => console.warn("[migration]", sql.slice(0, 60), e?.message));
  }
}

// ── Boot ─────────────────────────────────────────────────────────────────────
await loadFromDb();
loadSyncTokens();
initFromEnv();
await backfillUsers();
await bootstrapExtensions();
process.on("SIGTERM", () => onShutdown("SIGTERM"));
process.on("SIGINT",  () => onShutdown("SIGINT"));
startPoller();

// Operation mode banner — one informational log line so the operator knows the
// provider posture at boot. Helps when a subscription lapses unexpectedly.
{
  const { getOperationMode, getProviderAvailability } = await import("./providerSelection");
  const mode = getOperationMode();
  const av   = getProviderAvailability();
  const fallbacks = [
    av.openrouter && "openrouter", av.deepseek && "deepseek",
    ...av.customIds,
  ].filter(Boolean).join(", ") || "none";
  if (mode === "anthropic-primary") {
    console.log(`[boot] mode=anthropic-primary · anthropic=on · fallbacks=[${fallbacks}]`);
  } else if (mode === "fallback-only") {
    console.log(`[boot] mode=fallback-only · anthropic=off · routing via=[${fallbacks}] (set provider_override if needed)`);
  } else {
    console.warn(`[boot] mode=no-provider · NOTHING IS CONFIGURED · every /v1/messages request will return 503`);
  }
}

// ── Vite dev middleware ───────────────────────────────────────────────────────
// Dev: Vite runs in middlewareMode (no own port) — all traffic enters via Bun.serve,
// non-API requests are forwarded to Vite's Connect middleware stack.
// Prod: serve from dist/ with SPA fallback.
const isProduction = process.env.NODE_ENV === "production";

import type { ViteDevServer } from "vite";
let vite: ViteDevServer | null = null;

if (!isProduction) {
  const hotData = (import.meta as any).hot?.data ?? {};
  if (hotData.vite) {
    vite = hotData.vite as ViteDevServer;
  } else {
    const { createServer } = await import("vite");
    vite = await createServer({});
    if ((import.meta as any).hot) (import.meta as any).hot.data.vite = vite;
  }
  if ((import.meta as any).hot) {
    (import.meta as any).hot.dispose(() => { /* keep vite alive via hot.data */ });
  }
}

const MIME: Record<string, string> = {
  ".js":    "application/javascript; charset=utf-8",
  ".css":   "text/css; charset=utf-8",
  ".html":  "text/html; charset=utf-8",
  ".svg":   "image/svg+xml",
  ".png":   "image/png",
  ".ico":   "image/x-icon",
  ".json":  "application/json",
  ".woff":  "font/woff",
  ".woff2": "font/woff2",
};

async function serveFrontend(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;

  if (!isProduction && vite) {
    // SPA route (no file extension, not Vite-internal) → transform index.html
    if (!pathname.includes(".") && !pathname.startsWith("/@")) {
      let html = fs.readFileSync(path.join(vite.config.root, "index.html"), "utf-8");
      html = await vite.transformIndexHtml(pathname, html, request.url);
      return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    // Only try Vite transform for known transformable extensions or Vite-internal paths
    const TRANSFORMABLE = /\.(tsx?|jsx?|css|less|scss|sass|styl)(\?|$)/;
    if (TRANSFORMABLE.test(pathname) || pathname.startsWith("/@") || pathname.startsWith("/.vite/")) {
      try {
        const result = await vite!.transformRequest(pathname + url.search, { ssr: false });
        if (result) {
          return new Response(result.code, {
            headers: { "Content-Type": "application/javascript; charset=utf-8" },
          });
        }
      } catch (e: any) {
        console.error("[vite transform]", pathname, e?.message ?? e);
        return new Response(e?.message ?? String(e), { status: 500, headers: { "Content-Type": "text/plain" } });
      }
    }

    // Static asset (image, font, etc.) → serve from Vite root
    const assetPath = path.join(vite!.config.root, pathname);
    if (fs.existsSync(assetPath)) {
      const ext = path.extname(pathname);
      const headers: Record<string, string> = {};
      if (MIME[ext]) headers["Content-Type"] = MIME[ext];
      return new Response(Bun.file(assetPath), { headers });
    }

    return new Response("Not Found", { status: 404 });
  }

  // Production: static files from dist/ + SPA fallback
  const safePath = pathname.replace(/\.\./g, "");
  const filePath = path.join("dist", safePath === "/" ? "index.html" : safePath);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath);
    const headers: Record<string, string> = {};
    if (MIME[ext]) headers["Content-Type"] = MIME[ext];
    if (safePath.startsWith("/assets/")) headers["Cache-Control"] = "public, max-age=31536000, immutable";
    return new Response(Bun.file(filePath), { headers });
  }
  return new Response(Bun.file("dist/index.html"), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" },
  });
}

// ── Chat store ────────────────────────────────────────────────────────────────
interface ChatMsg { id: string; type: "chat" | "system"; nick: string; text: string; ts: number; }
const chatStore:    ChatMsg[]    = [];
const chatBlocklist = new Set<string>(); // lowercase nicks
const chatRateLimit = new Map<ServerWebSocket<any>, number>();

function broadcastChatMsg(msg: ChatMsg) {
  chatStore.push(msg);
  if (chatStore.length > 100) chatStore.splice(0, chatStore.length - 100);
  const payload = JSON.stringify({ type: "chat_message", message: msg });
  for (const ws of wsClients) ws.send(payload);
}

function broadcastRaw(payload: string) {
  for (const ws of wsClients) ws.send(payload);
}

// ── WebSocket clients ─────────────────────────────────────────────────────────
type WsData = { isAdmin: boolean; connectedAt?: number };
const wsClients = new Set<ServerWebSocket<WsData>>();

// Cache userImages untuk WebSocket push (refresh setiap 5 menit)
let userImagesCache: Record<string, string> = {};
async function refreshUserImages() {
  try {
    const rows = await prisma.user.findMany({ select: { name: true, image: true } });
    userImagesCache = Object.fromEntries(rows.filter(r => r.image).map(r => [r.name, r.image!]));
  } catch {}
}
refreshUserImages();
setInterval(refreshUserImages, 5 * 60_000);

startMaintenanceScheduler();

function buildStatusPayload(isAdmin: boolean) {
  const now   = Date.now();
  const today = todayKey();
  const fmtCd = (ms: number) => {
    if (ms <= 0) return "now";
    const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
  };
  const tokenData = buildTokenData();
  return {
    ts:          new Date().toISOString(),
    pollAge:     upstream.lastPoll ? fmtCd(now - upstream.lastPoll) + " ago" : "pending",
    isAdmin,
    totalAllTime: totalTokensAllTime,
    tokens:      tokenData,
    upstream: {
      ok:     upstream.lastPollOk,
      stale:  !upstream.lastPollOk && !!upstream.fiveHour,
      error:  isAdmin ? upstream.lastError : null,
      email:  isAdmin ? upstream.tokenCache.email : null,
      pollAge:   upstream.lastPoll ? fmtCd(now - upstream.lastPoll) : null,
      nextPoll:  upstream.pollBackoffUntil > now ? fmtCd(upstream.pollBackoffUntil - now) : null,
      fiveHour:       upstream.fiveHour,
      sevenDay:       upstream.sevenDay,
      sevenDaySonnet: upstream.sevenDaySonnet,
      sevenDayOpus:   upstream.sevenDayOpus,
    },
    userImages:       userImagesCache,
  };
}

_broadcast.fn = () => {
  if (!wsClients.size) return;
  const adminPayload  = JSON.stringify(buildStatusPayload(true));
  const publicPayload = JSON.stringify(buildStatusPayload(false));
  for (const ws of wsClients) {
    ws.send(ws.data.isAdmin ? adminPayload : publicPayload);
  }
};

_broadcastSystemMsg.fn = (text: string) => {
  broadcastChatMsg({ id: crypto.randomUUID(), type: "system", nick: "system", text, ts: Date.now() });
};

_broadcastNotifChanged.fn = () => {
  if (!wsClients.size) return;
  const payload = JSON.stringify({ type: "notif_changed" });
  for (const ws of wsClients) ws.send(payload);
};

function extractKey(req: Request): string {
  const apiKey = req.headers.get("x-api-key") || "";
  if (apiKey) return apiKey;
  const auth = req.headers.get("authorization") || "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return "";
}

async function checkAdmin(req: Request): Promise<boolean> {
  if (config.adminKey) {
    const h = req.headers.get("x-admin-key") || "";
    if (h && h === config.adminKey) return true;
  }
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session?.user?.email) return false;
    const email = session.user.email.toLowerCase();
    if (config.superAdminEmails.has(email)) return true;
    const u = Object.values(users).find(u => u.email?.toLowerCase() === email);
    return u?.role === "SUPER_ADMIN" || u?.role === "ADMIN";
  } catch {
    return false;
  }
}

async function checkUser(req: Request): Promise<{ userId: string; email: string } | null> {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) return null;
    const email = session.user.email;
    for (const [id, u] of Object.entries(users)) {
      if (u.email === email) return { userId: id, email };
    }
    return null;
  } catch {
    return null;
  }
}



// ── Server ────────────────────────────────────────────────────────────────────
let server: ReturnType<typeof serve>;
server = serve({
  port: config.port,
  idleTimeout: 0,

  websocket: {
    open(ws: ServerWebSocket<WsData>) {
      ws.data.connectedAt = Date.now();
      wsClients.add(ws);
      ws.send(JSON.stringify(buildStatusPayload(ws.data.isAdmin)));
      if (chatStore.length > 0) {
        ws.send(JSON.stringify({ type: "chat_history", messages: chatStore }));
      }
    },
    close(ws: ServerWebSocket<WsData>) {
      wsClients.delete(ws);
      chatRateLimit.delete(ws);
    },
    message(ws: ServerWebSocket<WsData>, raw: string | Buffer) {
      try {
        const msg = JSON.parse(String(raw));
        if (msg.type !== "chat") return;
        const now = Date.now();
        if (now - (chatRateLimit.get(ws) ?? 0) < 2000) return;
        chatRateLimit.set(ws, now);
        const nick = String(msg.nick || "").trim().slice(0, 20) || "Anonymous";
        const text = String(msg.text || "").trim().slice(0, 500);
        if (!text) return;
        if (chatBlocklist.has(nick.toLowerCase())) return; // silently drop
        broadcastChatMsg({ id: crypto.randomUUID(), type: "chat", nick, text, ts: now });
      } catch {}
    },
  },

  error(err: Error) {
    console.error("[server error]", err);
    return new Response(`<!doctype html><html><head><title>500</title><style>body{font-family:monospace;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#1a1b1e;color:#c1c2c5}.box{text-align:center}.code{font-size:4rem;font-weight:700;color:#fa5252;margin:0}.msg{color:#868e96;margin-top:8px}</style></head><body><div class="box"><p class="code">500</p><p class="msg">Internal server error</p></div></body></html>`, { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } });
  },

  fetch: async (req) => {
    // Better Auth handles all /api/auth/** — must be in fetch (not routes) for multi-segment paths
    if (new URL(req.url).pathname.startsWith("/api/auth")) {
      return auth.handler(req);
    }
    return serveFrontend(req);
  },

  routes: {
    "/__open-in-editor": async req => {
      if (isProduction) return new Response("Not found", { status: 404 });
      if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
      const { relativePath, lineNumber, columnNumber } = await req.json() as Record<string, string>;
      const editor = process.env.REACT_EDITOR || "code";
      const loc = `${process.cwd()}/${relativePath}:${lineNumber}:${columnNumber}`;
      const noGoto = ["subl", "zed"];
      const args = noGoto.includes(editor) ? [loc] : ["--goto", loc];
      if (Bun.which(editor)) Bun.spawn([editor, ...args], { stdio: ["ignore", "ignore", "ignore"] });
      return new Response("ok");
    },

    // WebSocket — real-time status push
    "/ws": async (req) => {
      const isAdmin = await checkAdmin(req);
      const upgraded = server.upgrade(req, { data: { isAdmin } });
      if (upgraded) return;
      return new Response("WebSocket upgrade failed", { status: 400 });
    },

    // Login / logout — now handled by React /login page + Better Auth
    "/admin/login": () => new Response(null, { status: 301, headers: { Location: "/login" } }),

    "/admin/logout": async req => {
      const signOutReq = new Request(new URL("/api/auth/sign-out", req.url).href, {
        method: "POST",
        headers: req.headers,
      });
      const resp = await auth.handler(signOutReq);
      const headers = new Headers(resp.headers);
      headers.set("Location", "/login");
      return new Response(null, { status: 303, headers });
    },

    // Google login — initiates OAuth flow via Better Auth, stays GET-friendly
    "/auth/google/login": async req => {
      if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });
      const callbackURL = new URL(req.url).searchParams.get("callbackURL") || "/profile";
      const resp = await auth.api.signInSocial({
        body: { provider: "google", callbackURL },
        asResponse: true,
      });
      // If Better Auth already returns a redirect, forward it directly (preserves Set-Cookie/state)
      if (resp.status >= 300 && resp.status < 400) return resp;
      // JSON { url, redirect: true } — copy all headers (including Set-Cookie) into the redirect
      const data = await resp.json() as any;
      if (data?.url) {
        const headers = new Headers(resp.headers);
        headers.set("Location", data.url);
        return new Response(null, { status: 302, headers });
      }
      return new Response(JSON.stringify(data), { status: resp.status, headers: { "Content-Type": "application/json" } });
    },
    "/auth/logout": async req => {
      if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });
      const signOutReq = new Request(new URL("/api/auth/sign-out", req.url).href, {
        method: "POST",
        headers: req.headers,
      });
      const resp = await auth.handler(signOutReq);
      const headers = new Headers(resp.headers);
      headers.set("Location", "/login");
      return new Response(null, { status: 303, headers });
    },

    // Dev-only backdoor for E2E/Playwright. Guard: env DEV_LOGIN_SECRET must
    // be set AND request must carry matching x-dev-secret header. Production
    // never sets this var → endpoint returns 404 there.
    "/api/dev/login": async req => handleDevLogin(req),

    // User profile API
    "/api/profile": async req => {
      const u = await checkUser(req);
      if (!u) return Response.json({ authenticated: false }, { status: 401 });
      const today = todayKey();

      // Resolve global effective provider — mirrors proxy.ts logic so user sees actual routing
      const { getCustomProvider } = await import("./customProviders");
      const globalOverride = settings["provider_override"] || "";
      const dsConfigured = !!settings["deepseek_api_key"];
      const orConfigured = !!settings["openrouter_api_key"];
      const overrideValid =
        globalOverride === "anthropic" ||
        (globalOverride === "deepseek"   && dsConfigured) ||
        (globalOverride === "openrouter" && orConfigured) ||
        (globalOverride !== "" && !!getCustomProvider(globalOverride)?.api_key);
      const globalEffective = overrideValid ? globalOverride : (upstream.fallbackProvider ?? "anthropic");

      const userTokens: Record<string, any> = {};
      for (const [k, tk] of Object.entries(tokens)) {
        if (tk.user_id === u.userId) {
          const limit = tk.limit === Infinity ? null : tk.limit;
          const tokenProvider = tk.provider || "inherit";
          const effectiveProvider = tokenProvider === "inherit" ? globalEffective : tokenProvider;
          userTokens[k] = {
            key:                k,
            name:               resolveTokenName(k, tk),
            label:              tk.label || "",
            description:        tk.description || "",
            used:               tk.used,
            limit,
            remaining:          limit ? Math.max(0, limit - tk.used) : null,
            pct:                limit ? Math.round((tk.used / limit) * 100) : 0,
            paused:             tk.paused,
            provider:           tokenProvider,
            effective_provider: effectiveProvider,
            pinned_model:       tk.pinned_model || "",
            today:              (dailyUsage[today] || {})[k] || 0,
            alltime:            allTimePerUser[u.userId] || 0,
            last_reset:         tk.last_reset || 0,
          };
        }
      }
      const userEntry = users[u.userId];
      const userStatus = userEntry?.status || "pending";
      const demoMode   = settings["demo_mode"] === "true";
      const effectiveStatus = demoMode && userStatus === "pending" ? "approved" : userStatus;
      const baUser = await prisma.user.findFirst({ where: { email: u.email }, select: { image: true } });
      // Custom providers — only id/name/color/type (no api_key) so users can display labels
      const { getCustomProviders } = await import("./customProviders");
      const customProvidersList = getCustomProviders().map(p => ({
        id: p.id, name: p.name, color: p.color || "gray", type: p.type,
      }));
      return Response.json({
        authenticated: true,
        userId:   u.userId,
        email:    u.email,
        name:     userEntry?.name || u.email,
        image:    baUser?.image ?? null,
        role:     userEntry?.role || "USER",
        status:   effectiveStatus,
        tokens:   userTokens,
        custom_providers: customProvidersList,
        context_blocked:             userEntry?.context_blocked_at ? true : false,
        context_block_reason:        userEntry?.context_block_reason ?? null,
        context_blocked_at:          userEntry?.context_blocked_at ?? null,
        context_block_grace_until:   userEntry?.context_block_grace_until ?? null,
      });
    },

    // Static built assets
    "/static/*": req => {
      const url = new URL(req.url);
      const file = Bun.file("public" + url.pathname.slice(7));
      return new Response(file);
    },

    // API — public
    "/api/status": async req => {
      const isAdm = await checkAdmin(req);
      return handleApiStatus(req, new URL(req.url), isAdm, userImagesCache);
    },

    // API — admin only (also accepts MCP secret for explain_log tool)
    "/api/logs/*": async req => {
      const mcpOk = config.mcpSecret && (req.headers.get("x-mcp-secret") === config.mcpSecret);
      if (!mcpOk && !await checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      try { return handleApiLogs(req, new URL(req.url), true); }
      catch (e: any) { return Response.json({ error: String(e?.message || e) }, { status: 500 }); }
    },
    "/api/logs": async req => {
      const isAdm = await checkAdmin(req);
      try { return handleApiLogs(req, new URL(req.url), isAdm); }
      catch (e: any) { return Response.json({ error: String(e?.message || e) }, { status: 500 }); }
    },
    "/api/analytics": async req => handleApiAnalytics(await checkAdmin(req)),
    "/api/admin/user-activity": async req => {
      if (!await checkUser(req) && !await checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      return handleApiUserActivity();
    },

    // ── DB Sync ──────────────────────────────────────────────────────────────
    // Generate sync token (stg side) — persists until revoked
    "/api/admin/db/generate-sync-token": async req => {
      if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
      if (!await checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      const entry = generateSyncToken();
      return Response.json({ token: entry.token, created_at: new Date(entry.created_at).toISOString() });
    },
    // List active sync tokens (stg side)
    "/api/admin/db/sync-tokens": async req => {
      if (!await checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      return Response.json({ tokens: listSyncTokens().map(t => ({ token: t.token, created_at: new Date(t.created_at).toISOString() })) });
    },
    // Revoke sync token (stg side)
    "/api/admin/db/revoke-sync-token": async req => {
      if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
      if (!await checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      const { token } = await req.json() as { token: string };
      revokeSyncToken(token);
      return Response.json({ ok: true });
    },
    // Export all DB data (stg side, authenticated via sync token)
    "/api/admin/db/export": async req => {
      return handleDbExport(req);
    },
    // Pull & import from remote (dev side)
    "/api/admin/db/sync": async req => {
      if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
      if (!await checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      return handleDbSync(req);
    },
    "/api/admin/db/stats": async req => {
      if (!await checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      const [rows, size, msgRows] = await Promise.all([
        prisma.request_logs.count(),
        prisma.$queryRaw<{ size_bytes: bigint }[]>`
          SELECT pg_total_relation_size('request_logs') AS size_bytes
        `,
        prisma.request_logs.count({ where: { messages_json: { not: "" } } }),
      ]);
      return Response.json({
        rows,
        size_bytes: size[0].size_bytes.toString(),
        rows_with_messages: msgRows,
      });
    },
    "/api/admin/db/retention": async req => {
      if (!await checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      if (req.method === "GET") {
        return Response.json({
          log_retention_days:  parseInt(settings["log_retention_days"]  || "30"),
          msg_retention_days:  parseInt(settings["msg_retention_days"]  || "7"),
        });
      }
      if (req.method === "POST") {
        const body = await req.json() as any;
        const logDays = Math.max(1, parseInt(body.log_retention_days) || 30);
        const msgDays = Math.max(1, parseInt(body.msg_retention_days) || 7);
        await dbSaveSetting("log_retention_days", String(logDays));
        await dbSaveSetting("msg_retention_days", String(msgDays));
        return Response.json({ ok: true, log_retention_days: logDays, msg_retention_days: msgDays });
      }
      return new Response("Method not allowed", { status: 405 });
    },
    "/api/admin/db/prune": async req => {
      if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
      if (!await checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      const result = await pruneRequestLogs();
      return Response.json({ ok: true, ...result });
    },
    "/api/competition": async req => {
      const u = await checkUser(req);
      if (!u) return Response.json({ error: "Unauthorized" }, { status: 401 });
      return handleApiCompetition(u.userId);
    },
    "/api/sessions/summary": () => handleApiSessionsSummary(),
    "/api/sessions/*": req => {
      const user = new URL(req.url).pathname.slice("/api/sessions/".length);
      return handleApiSessions(decodeURIComponent(user));
    },
    "/api/mind":          () => handleApiMind(),
    "/api/race":          () => handleApiRace(),
    "/api/version":       () => Response.json({ version: APP_VERSION }),
    "/api/usage/hourly":  () => handleApiUsageHourly(),  // already async
    "/api/admin/test": async req => {
      if (!await checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      return handleApiTest();
    },
    "/api/admin/test/deepseek": async req => {
      if (!await checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      return handleDeepSeekTest();
    },
    "/api/admin/test/openrouter": async req => {
      if (!await checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      return handleOpenRouterTest();
    },
    "/api/admin/test/:id": async req => {
      if (!await checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      const m = new URL(req.url).pathname.match(/^\/api\/admin\/test\/([a-z][a-z0-9-]*)$/);
      if (!m) return Response.json({ error: "Bad provider id" }, { status: 400 });
      return handleCustomProviderTest(m[1]!);
    },
    "/api/admin/credits/deepseek": async req => {
      if (!await checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      return handleApiCredits(req, new URL(req.url));
    },
    "/api/admin/credits/openrouter": async req => {
      if (!await checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      return handleApiCredits(req, new URL(req.url));
    },
    "/api/admin/settings": async req => {
      if (!await checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      return Response.json(settings);
    },
    "/api/admin/extensions": async req => {
      if (!await checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      return handleApiExtensions(req, new URL(req.url));
    },
    "/api/admin/extensions/*": async req => {
      if (!await checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      return handleApiExtensions(req, new URL(req.url));
    },
    "/api/admin/second-brain/*": async req => {
      if (!await checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      return handleSecondBrainAdmin(req, new URL(req.url));
    },
    "/api/admin/log-management/*": async req => {
      if (!await checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      return handleLogManagementAdmin(req, new URL(req.url));
    },
    "/mcp/second-brain": async req => handleMcpSecondBrain(req),
    "/api/admin/models/anthropic":  async req => {
      if (!await checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      return handleApiModels(req, new URL(req.url));
    },
    "/api/admin/models/deepseek":   async req => {
      if (!await checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      return handleApiModels(req, new URL(req.url));
    },
    "/api/admin/models/openrouter": async req => {
      if (!await checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      return handleApiModels(req, new URL(req.url));
    },
    "/api/admin/models/:id": async req => {
      if (!await checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      return handleApiModels(req, new URL(req.url));
    },
    "/api/admin/custom-providers": async req => {
      if (!await checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      return handleApiCustomProviders(req, new URL(req.url));
    },
    "/api/admin/custom-providers/:id": async req => {
      if (!await checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      return handleApiCustomProviders(req, new URL(req.url));
    },
    "/api/admin/credentials": async req => {
      if (!await checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      return handleAuthStatus();
    },
    "/api/admin/credentials/remove": async req => {
      if (!await checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      return handleAuthRemove(req);
    },
    "/admin/auth/start": async req => {
      if (!await checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      return handleAuthStart(req);
    },
    "/admin/auth/exchange": async req => {
      if (!await checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      return handleAuthExchange(req);
    },
    "/admin/auth/import": async req => {
      if (!await checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      return handleAuthImport(req);
    },
    "/api/stats": async req => {
      if (!await checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      return handleApiStats();
    },
    // Chat moderation
    "/admin/chat/clear": async req => {
      if (!await checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      chatStore.splice(0, chatStore.length);
      broadcastRaw(JSON.stringify({ type: "chat_clear" }));
      broadcastChatMsg({ id: crypto.randomUUID(), type: "system", nick: "system", text: "🗑️ Chat cleared by admin", ts: Date.now() });
      return Response.json({ ok: true });
    },
    "/admin/chat/block": async req => {
      if (!await checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      const { nick } = await req.json() as any;
      const n = String(nick || "").trim();
      if (!n) return Response.json({ error: "Missing nick" }, { status: 400 });
      chatBlocklist.add(n.toLowerCase());
      broadcastChatMsg({ id: crypto.randomUUID(), type: "system", nick: "system", text: `🚫 ${n} has been blocked`, ts: Date.now() });
      return Response.json({ ok: true });
    },
    "/admin/chat/unblock": async req => {
      if (!await checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      const { nick } = await req.json() as any;
      const n = String(nick || "").trim();
      chatBlocklist.delete(n.toLowerCase());
      broadcastChatMsg({ id: crypto.randomUUID(), type: "system", nick: "system", text: `✅ ${n} has been unblocked`, ts: Date.now() });
      return Response.json({ ok: true });
    },
    "/admin/chat/blocked": async req => {
      if (!await checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      return Response.json({ blocked: [...chatBlocklist] });
    },

    // Debug endpoints — auth via x-mcp-secret (untuk MCP proxy-stg)
    "/api/debug/query":            async req => handleDebugQuery(req),
    "/api/debug/token/*":          async req => handleDebugToken(req, new URL(req.url)),
    "/api/debug/upstream-history": async req => handleDebugUpstreamHistory(req),
    "/api/debug/quota-pressure":   async req => handleDebugQuotaPressure(req),
    "/api/debug/console":          async req => handleDebugConsole(req, new URL(req.url)),
    "/api/debug/runtime":          async req => handleDebugRuntime(req),
    "/api/debug/users":            async req => handleDebugUsers(req),
    "/api/debug/settings":         async req => handleDebugSettings(req),
    "/api/debug/proxy-errors":     async req => handleDebugProxyErrors(req, new URL(req.url)),
    "/api/debug/sync-tokens":      async req => handleDebugSyncTokens(req),
    "/api/debug/credits/*":        async req => handleDebugCredits(req, new URL(req.url)),
    "/api/debug/extensions":       async req => handleDebugExtensions(req),
    "/api/debug/brain/overview":   async req => handleDebugBrainOverview(req),
    "/api/debug/brain/strategies": async req => handleDebugBrainStrategies(req, new URL(req.url)),
    "/api/debug/brain/queue":      async req => handleDebugBrainQueue(req),
    "/api/debug/db-size":          async req => handleDebugDbSize(req),
    "/api/debug/sessions-summary": async req => handleDebugSessionsSummary(req),
    "/api/debug/test-upstream/*":  async req => handleDebugTestUpstream(req, new URL(req.url)),
    "/api/debug/active-providers": async req => handleDebugActiveProviders(req, new URL(req.url)),
    "/api/debug/app-logs":         async req => handleDebugAppLogs(req, new URL(req.url)),
    "/api/debug/app-logs/stats":   async req => handleDebugAppLogsStats(req, new URL(req.url)),
    "/api/debug/notifications":   async req => handleDebugNotifications(req, new URL(req.url)),
    "/api/debug/ws":               async req => {
      // WS stats inline because wsClients lives in this module
      const t = req.headers.get("x-mcp-secret") || req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
      if (!config.mcpSecret || t !== config.mcpSecret) return Response.json({ error: "Unauthorized" }, { status: 401 });
      const now = Date.now();
      const conns = [...wsClients].map(ws => ({
        is_admin:      !!ws.data?.isAdmin,
        connected_at:  ws.data?.connectedAt ?? null,
        age_sec:       ws.data?.connectedAt ? Math.round((now - ws.data.connectedAt) / 1000) : null,
        ready_state:   ws.readyState,
      }));
      return Response.json({
        total:   conns.length,
        admin:   conns.filter(c => c.is_admin).length,
        public:  conns.filter(c => !c.is_admin).length,
        oldest_age_sec: conns.length ? Math.max(...conns.map(c => c.age_sec || 0)) : 0,
        connections: conns,
      });
    },

    // Users API (admin only)
    "/api/admin/users": async req => {
      if (!await checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      return handleApiUsers(req, new URL(req.url), users, tokens, dailyUsage, allTimePerUser);
    },
    "/api/admin/users/*": async req => {
      if (!await checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      return handleApiUsers(req, new URL(req.url), users, tokens, dailyUsage, allTimePerUser);
    },

    // Role management (SUPER_ADMIN only)
    "/api/admin/users/*/role": async req => {
      if (!await checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
      const parts = new URL(req.url).pathname.split("/");
      const userId = decodeURIComponent(parts[4] || "");
      const { role } = await req.json() as any;
      if (!["SUPER_ADMIN", "ADMIN", "USER"].includes(role)) return Response.json({ error: "Invalid role" }, { status: 400 });
      if (!users[userId]) return Response.json({ error: "User not found" }, { status: 404 });
      // Prevent demoting a SUPER_ADMIN_EMAILS user
      const u = users[userId];
      if (u && config.superAdminEmails.has((u.email || "").toLowerCase()) && role !== "SUPER_ADMIN") {
        return Response.json({ error: "Cannot change role of a SUPER_ADMIN_EMAILS user" }, { status: 403 });
      }
      dbSetUserRole(userId, role);
      triggerBroadcast();
      return Response.json({ ok: true });
    },

    // Admin notifications (broadcast to all/specific users)
    "/api/admin/notifications": async req => {
      if (!await checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      if (req.method === "GET") return handleAdminListNotifications();
      if (req.method === "POST") {
        let adminEmail = "";
        try { adminEmail = (await auth.api.getSession({ headers: req.headers }))?.user?.email || ""; } catch {}
        return handleAdminCreateNotification(req, adminEmail);
      }
      return new Response("Method not allowed", { status: 405 });
    },
    "/api/admin/notifications/:id": async req => {
      if (!await checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      if (req.method !== "DELETE") return new Response("Method not allowed", { status: 405 });
      const id = decodeURIComponent(new URL(req.url).pathname.split("/").pop() || "");
      return handleAdminDeleteNotification(id);
    },

    // User-facing notifications (pending + dismiss)
    "/api/notifications/pending": async req => {
      const u = await checkUser(req);
      if (!u) return Response.json({ error: "Unauthorized" }, { status: 401 });
      return handleUserPendingNotifications(u.userId);
    },
    "/api/notifications/:id/dismiss": async req => {
      const u = await checkUser(req);
      if (!u) return Response.json({ error: "Unauthorized" }, { status: 401 });
      if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
      const parts = new URL(req.url).pathname.split("/");
      const id = decodeURIComponent(parts[3] || "");
      return handleUserDismissNotification(u.userId, id);
    },

    "/api/admin/broadcast/refresh": async req => {
      if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
      if (!await checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      triggerBroadcast();
      return Response.json({ ok: true, clients: wsClients.size });
    },
    "/api/admin/broadcast/reload": async req => {
      if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
      if (!await checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      const payload = JSON.stringify({ type: "force_reload" });
      let count = 0;
      for (const ws of wsClients) { ws.send(payload); count++; }
      return Response.json({ ok: true, clients: count });
    },

    // Admin actions
    "/admin/reset":              async req => { if (!await checkAdmin(req)) return new Response(null, { status: 303, headers: { Location: "/login" } }); return handleAdmin(req, new URL(req.url)); },
    "/admin/logs/clear":         async req => { if (!await checkAdmin(req)) return new Response(null, { status: 303, headers: { Location: "/login" } }); return handleAdmin(req, new URL(req.url)); },
    "/admin/usage/clear":        async req => { if (!await checkAdmin(req)) return new Response(null, { status: 303, headers: { Location: "/login" } }); return handleAdmin(req, new URL(req.url)); },
    "/admin/token/add":          async req => { if (!await checkAdmin(req)) return new Response(null, { status: 303, headers: { Location: "/login" } }); return handleAdmin(req, new URL(req.url)); },
    "/admin/token/edit":         async req => { if (!await checkAdmin(req)) return new Response(null, { status: 303, headers: { Location: "/login" } }); return handleAdmin(req, new URL(req.url)); },
    "/admin/token/edit-all":     async req => { if (!await checkAdmin(req)) return new Response(null, { status: 303, headers: { Location: "/login" } }); return handleAdmin(req, new URL(req.url)); },
    "/admin/token/pause":        async req => { if (!await checkAdmin(req)) return new Response(null, { status: 303, headers: { Location: "/login" } }); return handleAdmin(req, new URL(req.url)); },
    "/admin/token/delete":       async req => { if (!await checkAdmin(req)) return new Response(null, { status: 303, headers: { Location: "/login" } }); return handleAdmin(req, new URL(req.url)); },
    "/admin/token/rotate":       async req => { if (!await checkAdmin(req)) return new Response(null, { status: 303, headers: { Location: "/login" } }); return handleAdmin(req, new URL(req.url)); },
    "/admin/token/provider":     async req => { if (!await checkAdmin(req)) return new Response(null, { status: 303, headers: { Location: "/login" } }); return handleAdmin(req, new URL(req.url)); },
    "/admin/token/meta":         async req => { if (!await checkAdmin(req)) return new Response(null, { status: 303, headers: { Location: "/login" } }); return handleAdmin(req, new URL(req.url)); },
    "/admin/token/pin-model":    async req => { if (!await checkAdmin(req)) return new Response(null, { status: 303, headers: { Location: "/login" } }); return handleAdmin(req, new URL(req.url)); },
    "/admin/token/pin-all":      async req => { if (!await checkAdmin(req)) return new Response(null, { status: 303, headers: { Location: "/login" } }); return handleAdmin(req, new URL(req.url)); },
    "/admin/user/edit":          async req => { if (!await checkAdmin(req)) return new Response(null, { status: 303, headers: { Location: "/login" } }); return handleAdmin(req, new URL(req.url)); },
    "/admin/user/set-email":     async req => { if (!await checkAdmin(req)) return new Response(null, { status: 303, headers: { Location: "/login" } }); return handleAdmin(req, new URL(req.url)); },
    "/admin/users/purge-orphans": async req => { if (!await checkAdmin(req)) return new Response(null, { status: 303, headers: { Location: "/login" } }); return handleAdmin(req, new URL(req.url)); },
    "/admin/settings/deepseek":    async req => { if (!await checkAdmin(req)) return new Response(null, { status: 303, headers: { Location: "/login" } }); return handleAdmin(req, new URL(req.url)); },
    "/admin/settings/openrouter": async req => { if (!await checkAdmin(req)) return new Response(null, { status: 303, headers: { Location: "/login" } }); return handleAdmin(req, new URL(req.url)); },
    "/admin/user/set-status":          async req => { if (!await checkAdmin(req)) return new Response(null, { status: 303, headers: { Location: "/login" } }); return handleAdmin(req, new URL(req.url)); },
    "/admin/user/context-grace":        async req => { if (!await checkAdmin(req)) return new Response(null, { status: 303, headers: { Location: "/login" } }); return handleAdmin(req, new URL(req.url)); },
    "/admin/user/block-context":        async req => { if (!await checkAdmin(req)) return new Response(null, { status: 303, headers: { Location: "/login" } }); return handleAdmin(req, new URL(req.url)); },
    "/admin/user/unblock-context":     async req => { if (!await checkAdmin(req)) return new Response(null, { status: 303, headers: { Location: "/login" } }); return handleAdmin(req, new URL(req.url)); },
    "/admin/settings/demo":       async req => { if (!await checkAdmin(req)) return new Response(null, { status: 303, headers: { Location: "/login" } }); return handleAdmin(req, new URL(req.url)); },
    "/admin/settings/poll-interval": async req => { if (!await checkAdmin(req)) return new Response(null, { status: 303, headers: { Location: "/login" } }); return handleAdmin(req, new URL(req.url)); },
    "/admin/settings/provider-model": async req => { if (!await checkAdmin(req)) return new Response(null, { status: 303, headers: { Location: "/login" } }); return handleAdmin(req, new URL(req.url)); },
    "/admin/settings/provider-override": async req => { if (!await checkAdmin(req)) return new Response(null, { status: 303, headers: { Location: "/login" } }); return handleAdmin(req, new URL(req.url)); },
    "/admin/settings/simulate-anthropic-disabled": async req => { if (!await checkAdmin(req)) return new Response(null, { status: 303, headers: { Location: "/login" } }); return handleAdmin(req, new URL(req.url)); },
    "/admin/settings/reset-mode":                  async req => { if (!await checkAdmin(req)) return new Response(null, { status: 303, headers: { Location: "/login" } }); return handleAdmin(req, new URL(req.url)); },

    // Proxy endpoints
    "/v1/models": async req => {
      const key = extractKey(req);
      const t = tokens[key];
      if (!t) return Response.json({ error: { type: "authentication_error", message: "Invalid API key" } }, { status: 401 });
      return handleProxy(req, new URL(req.url), key, t);
    },
    "/v1/usage": async req => {
      const key = extractKey(req);
      const t = tokens[key];
      if (!t) return Response.json({ error: { type: "authentication_error", message: "Invalid API key" } }, { status: 401 });
      return handleProxy(req, new URL(req.url), key, t);
    },
    "/v1/messages": async req => {
      const key = extractKey(req);
      const t = tokens[key];
      if (!t) return Response.json({ error: { type: "authentication_error", message: "Invalid API key" } }, { status: 401 });
      return handleProxy(req, new URL(req.url), key, t);
    },
    "/v1/messages/count_tokens": async req => {
      const key = extractKey(req);
      const t = tokens[key];
      if (!t) return Response.json({ error: { type: "authentication_error", message: "Invalid API key" } }, { status: 401 });
      return handleProxy(req, new URL(req.url), key, t);
    },

    // 404 for unknown API/admin paths
    "/api/*": req => {
      if (new URL(req.url).pathname.startsWith("/api/auth")) return auth.handler(req);
      return Response.json({ error: "Not found" }, { status: 404 });
    },
    "/v1/*":  () => Response.json({ error: { type: "not_found_error", message: "Unknown endpoint" } }, { status: 404 }),
  },

});

console.log(`claude-proxy v2 :${server.port} ready`);
