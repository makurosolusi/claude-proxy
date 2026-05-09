import { serve, type ServerWebSocket } from "bun";
import fs from "node:fs";
import path from "node:path";

const APP_VERSION: string = JSON.parse(
  fs.readFileSync(path.join(import.meta.dir, "../package.json"), "utf8")
).version;
import { config }           from "./config";
import { loadFromDb, backfillUsers, onShutdown, tokens, users, upstream, dailyUsage, totalTokensAllTime, allTimePerUser, dbSetUserRole, modelRoutes, settings, resolveTokenName } from "./state";
import { initFromEnv, todayKey, maskToken } from "./tokens";
import { startPoller }     from "./upstream";
import { handleApiStatus } from "./handlers/apiStatus";
import { handleApiLogs }   from "./handlers/apiLogs";
import { handleApiStats }  from "./handlers/apiStats";
import { handleApiMind }   from "./handlers/apiMind";
import { handleApiRace }         from "./handlers/apiRace";
import { handleApiUsageHourly }  from "./handlers/apiUsageHourly";
import { handleApiSessions }     from "./handlers/apiSessions";
import { handleApiAnalytics }    from "./handlers/apiAnalytics";
import { handleApiTest }   from "./handlers/apiTest";
import { handleAuthStart, handleAuthExchange, handleAuthStatus, handleAuthRemove } from "./handlers/apiAuth";
import { handleDbDownload, handleDbUpload, handleDbInfo } from "./handlers/apiDb";
import { handleDebugQuery } from "./handlers/apiDebug";
import { handleDebugToken, handleDebugUpstreamHistory, handleDebugQuotaPressure } from "./handlers/apiDebugExtra";
import { handleAdmin }     from "./handlers/admin";
import { handleApiUsers }  from "./handlers/apiUsers";
import { handleApiModelRoutes } from "./handlers/apiModelRoutes";
import { handleProxy }     from "./handlers/proxy";
import { auth } from "./auth";
import { _broadcast, _broadcastSystemMsg, triggerBroadcast } from "./broadcast";

// ── Provider connection tests ─────────────────────────────────────────────────

async function handleDeepSeekTest(): Promise<Response> {
  const apiKey = settings["deepseek_api_key"] || config.deepseekApiKey;
  if (!apiKey) return Response.json({ ok: false, error: "No DeepSeek API key configured" });
  const baseUrl = settings["deepseek_base_url"] || config.deepseekBaseUrl;
  const t0 = Date.now();
  try {
    const r = await fetch(baseUrl + "/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: settings["deepseek_model"] || config.deepseekModel,
        max_tokens: 12,
        messages: [{ role: "user", content: "Reply with exactly the word: OK" }],
      }),
      signal: AbortSignal.timeout(10000),
    });
    const lat = Date.now() - t0;
    if (r.ok) {
      const d = await r.json() as any;
      const text = d?.content?.[0]?.text ?? "";
      const toks = (d?.usage?.input_tokens ?? 0) + (d?.usage?.output_tokens ?? 0);
      return Response.json({ ok: true, latency: lat, detail: `"${text.slice(0, 40)}" · ${toks} tokens` });
    }
    const d = await r.json().catch(() => ({})) as any;
    return Response.json({ ok: false, latency: lat, error: d?.error?.message ?? `HTTP ${r.status}` });
  } catch (e: any) {
    return Response.json({ ok: false, latency: Date.now() - t0, error: e.message });
  }
}

async function handleOpenRouterTest(): Promise<Response> {
  const apiKey = settings["openrouter_api_key"] || config.openrouterApiKey;
  if (!apiKey) return Response.json({ ok: false, error: "No OpenRouter API key configured" });
  const baseUrl = settings["openrouter_base_url"] || config.openrouterBaseUrl;
  const t0 = Date.now();
  try {
    const r = await fetch(baseUrl + "/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + apiKey,
        "anthropic-version": "2023-06-01",
        "HTTP-Referer": "https://claude-proxy.wibudev.com",
      },
      body: JSON.stringify({
        model: settings["openrouter_model"] || config.openrouterModel,
        max_tokens: 12,
        messages: [{ role: "user", content: "Reply with exactly the word: OK" }],
      }),
      signal: AbortSignal.timeout(10000),
    });
    const lat = Date.now() - t0;
    if (r.ok) {
      const d = await r.json() as any;
      const text = d?.content?.[0]?.text ?? "";
      const toks = (d?.usage?.input_tokens ?? 0) + (d?.usage?.output_tokens ?? 0);
      return Response.json({ ok: true, latency: lat, detail: `"${text.slice(0, 40)}" · ${toks} tokens` });
    }
    const d = await r.json().catch(() => ({})) as any;
    return Response.json({ ok: false, latency: lat, error: d?.error?.message ?? `HTTP ${r.status}` });
  } catch (e: any) {
    return Response.json({ ok: false, latency: Date.now() - t0, error: e.message });
  }
}

// ── Boot ─────────────────────────────────────────────────────────────────────
loadFromDb();
initFromEnv();
backfillUsers();
process.on("SIGTERM", () => onShutdown("SIGTERM"));
process.on("SIGINT",  () => onShutdown("SIGINT"));
startPoller();

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
type WsData = { isAdmin: boolean };
const wsClients = new Set<ServerWebSocket<WsData>>();

function buildStatusPayload(isAdmin: boolean) {
  const now   = Date.now();
  const today = todayKey();
  const fmtCd = (ms: number) => {
    if (ms <= 0) return "now";
    const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
  };
  const tokenData: Record<string, unknown> = {};
  for (const [k, tk] of Object.entries(tokens)) {
    const uid = tk.user_id || k;
    tokenData[k] = {
      label:     resolveTokenName(k, tk),
      name:      resolveTokenName(k, tk),
      user_id:   tk.user_id,
      used:      tk.used,
      limit:     tk.limit === Infinity ? null : tk.limit,
      remaining: tk.limit === Infinity ? null : Math.max(0, tk.limit - tk.used),
      pct:       tk.limit === Infinity ? 0 : Math.round((tk.used / tk.limit) * 100),
      paused:    tk.paused,
      today:     (dailyUsage[today] || {})[k] || 0,
      alltime:   allTimePerUser[uid] || 0,
    };
  }
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
    modelRoutes:      Object.values(modelRoutes),
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

    // User profile API
    "/api/profile": async req => {
      const u = await checkUser(req);
      if (!u) return Response.json({ authenticated: false }, { status: 401 });
      const today = todayKey();
      const userTokens: Record<string, any> = {};
      for (const [k, tk] of Object.entries(tokens)) {
        if (tk.user_id === u.userId) {
          const limit = tk.limit === Infinity ? null : tk.limit;
          userTokens[k] = {
            key:       k,
            name:      resolveTokenName(k, tk),
            used:      tk.used,
            limit,
            remaining: limit ? Math.max(0, limit - tk.used) : null,
            pct:       limit ? Math.round((tk.used / limit) * 100) : 0,
            paused:    tk.paused,
            provider:  tk.provider || "inherit",
            today:     (dailyUsage[today] || {})[k] || 0,
            alltime:   allTimePerUser[u.userId] || 0,
          };
        }
      }
      const userEntry = users[u.userId];
      return Response.json({
        authenticated: true,
        userId:   u.userId,
        email:    u.email,
        name:     userEntry?.name || u.email,
        role:     userEntry?.role || "USER",
        tokens:   userTokens,
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
      return handleApiStatus(req, new URL(req.url), isAdm);
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
    "/api/sessions/*": req => {
      const user = new URL(req.url).pathname.slice("/api/sessions/".length);
      return handleApiSessions(decodeURIComponent(user));
    },
    "/api/mind":          () => handleApiMind(),
    "/api/race":          () => handleApiRace(),
    "/api/version":       () => Response.json({ version: APP_VERSION }),
    "/api/usage/hourly":  () => handleApiUsageHourly(),
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
    "/api/admin/settings": async req => {
      if (!await checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      return Response.json(settings);
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

    "/api/admin/db/info": async req => {
      if (!await checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      return handleDbInfo();
    },
    "/api/admin/db/download": async req => {
      if (!await checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      return handleDbDownload();
    },
    "/api/admin/db/upload": async req => {
      if (!await checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      return handleDbUpload(req);
    },

    // Debug endpoints — auth via x-mcp-secret (untuk MCP debug-stg)
    "/api/debug/query":            async req => handleDebugQuery(req),
    "/api/debug/token/*":          async req => handleDebugToken(req, new URL(req.url)),
    "/api/debug/upstream-history": async req => handleDebugUpstreamHistory(req),
    "/api/debug/quota-pressure":   async req => handleDebugQuotaPressure(req),

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

    // Model routing (admin only)
    "/api/admin/model-routes": async req => {
      if (!await checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      return handleApiModelRoutes(req, new URL(req.url));
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
    "/admin/token/rename":       async req => { if (!await checkAdmin(req)) return new Response(null, { status: 303, headers: { Location: "/login" } }); return handleAdmin(req, new URL(req.url)); },
    "/admin/token/provider":     async req => { if (!await checkAdmin(req)) return new Response(null, { status: 303, headers: { Location: "/login" } }); return handleAdmin(req, new URL(req.url)); },
    "/admin/user/edit":          async req => { if (!await checkAdmin(req)) return new Response(null, { status: 303, headers: { Location: "/login" } }); return handleAdmin(req, new URL(req.url)); },
    "/admin/user/set-email":     async req => { if (!await checkAdmin(req)) return new Response(null, { status: 303, headers: { Location: "/login" } }); return handleAdmin(req, new URL(req.url)); },
    "/admin/users/purge-orphans": async req => { if (!await checkAdmin(req)) return new Response(null, { status: 303, headers: { Location: "/login" } }); return handleAdmin(req, new URL(req.url)); },
    "/admin/users/purge-legacy":  async req => { if (!await checkAdmin(req)) return new Response(null, { status: 303, headers: { Location: "/login" } }); return handleAdmin(req, new URL(req.url)); },
    "/admin/settings/deepseek":    async req => { if (!await checkAdmin(req)) return new Response(null, { status: 303, headers: { Location: "/login" } }); return handleAdmin(req, new URL(req.url)); },
    "/admin/settings/openrouter": async req => { if (!await checkAdmin(req)) return new Response(null, { status: 303, headers: { Location: "/login" } }); return handleAdmin(req, new URL(req.url)); },

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
