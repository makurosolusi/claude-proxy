import { serve, type ServerWebSocket } from "bun";
import fs from "node:fs";
import path from "node:path";

const APP_VERSION: string = JSON.parse(
  fs.readFileSync(path.join(import.meta.dir, "../package.json"), "utf8")
).version;
import { config }           from "./config";
import { loadFromDb, onShutdown, tokens, upstream, dailyUsage, totalTokensAllTime, dbCreateSession, dbCheckSession, dbDeleteSession } from "./state";
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
import { handleAdmin }     from "./handlers/admin";
import { handleProxy }     from "./handlers/proxy";
import { _broadcast, _broadcastSystemMsg } from "./broadcast";

// ── Boot ─────────────────────────────────────────────────────────────────────
loadFromDb();
initFromEnv();
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
    tokenData[k] = {
      label:     isAdmin ? k : tk.name,
      used:      tk.used,
      limit:     tk.limit === Infinity ? null : tk.limit,
      remaining: tk.limit === Infinity ? null : Math.max(0, tk.limit - tk.used),
      pct:       tk.limit === Infinity ? 0 : Math.round((tk.used / tk.limit) * 100),
      paused:    tk.paused,
      today:     (dailyUsage[today] || {})[k] || 0,
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

// ── Auth helpers ──────────────────────────────────────────────────────────────
function parseCookie(req: Request, name: string): string {
  const raw = req.headers.get("cookie") || "";
  for (const part of raw.split(";")) {
    const [k, v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v || "");
  }
  return "";
}

function extractKey(req: Request): string {
  const apiKey = req.headers.get("x-api-key") || "";
  if (apiKey) return apiKey;
  const auth = req.headers.get("authorization") || "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return "";
}

function checkAdmin(req: Request): boolean {
  if (config.adminKey) {
    const h = req.headers.get("x-admin-key") || "";
    if (h && h === config.adminKey) return true;
  }
  const token = parseCookie(req, "admin_session");
  return token !== "" && dbCheckSession(token);
}

function loginPage(error?: string): Response {
  const errHtml = error ? `<p style="color:#ef4444;font-size:.85rem;margin:0 0 12px">${error}</p>` : "";
  return new Response(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>claude-proxy · login</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:ui-monospace,SFMono-Regular,"SF Mono",Menlo,monospace;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px;background:#f8f9fa;color:#1c1c1e}
@media(prefers-color-scheme:dark){body{background:#1a1b1e;color:#c1c2c5}}
.card{background:#fff;border:1px solid #dee2e6;border-radius:16px;padding:32px;width:100%;max-width:360px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
@media(prefers-color-scheme:dark){.card{background:#25262b;border-color:#373a40}}
.logo{width:36px;height:36px;background:#228be6;border-radius:10px;display:flex;align-items:center;justify-content:center;margin-bottom:16px}
.logo span{color:#fff;font-size:.75rem;font-weight:700}
h1{font-size:1.1rem;font-weight:700;margin-bottom:2px}
.sub{font-size:.8rem;color:#868e96;margin-bottom:24px}
label{display:block;font-size:.75rem;font-weight:600;color:#868e96;margin-bottom:6px;text-transform:uppercase;letter-spacing:.04em}
input{width:100%;padding:10px 12px;border:1px solid #dee2e6;border-radius:8px;font-size:.875rem;font-family:inherit;background:#fff;color:#1c1c1e;outline:none;margin-bottom:16px;transition:border-color .15s}
input:focus{border-color:#228be6}
@media(prefers-color-scheme:dark){input{background:#2c2e33;border-color:#373a40;color:#c1c2c5}}
@media(prefers-color-scheme:dark){input:focus{border-color:#339af0}}
button{width:100%;padding:10px;background:#228be6;color:#fff;border:none;border-radius:8px;font-size:.875rem;font-weight:600;cursor:pointer;font-family:inherit;margin-top:4px;transition:background .15s}
button:hover{background:#1c7ed6}
</style>
</head>
<body>
<div class="card">
  <div class="logo"><span>CP</span></div>
  <h1>claude-proxy</h1>
  <p class="sub">Sign in to admin dashboard</p>
  ${errHtml}
  <form method="POST" action="/admin/login">
    <label>Username</label>
    <input type="text" name="username" autocomplete="username" autofocus required placeholder="username">
    <label>Password</label>
    <input type="password" name="password" autocomplete="current-password" required placeholder="••••••••">
    <button type="submit">Sign in</button>
  </form>
</div>
</body>
</html>`, { headers: { "Content-Type": "text/html; charset=utf-8" } });
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

  fetch: (req) => serveFrontend(req),

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
    "/ws": (req) => {
      const isAdmin = checkAdmin(req);
      const upgraded = server.upgrade(req, { data: { isAdmin } });
      if (upgraded) return;
      return new Response("WebSocket upgrade failed", { status: 400 });
    },

    // Login / logout
    "/admin/login": async req => {
      if (req.method === "GET") return loginPage();
      const form = await req.formData();
      const username = String(form.get("username") || "").trim();
      const password = String(form.get("password") || "").trim();
      if (config.adminUsername && config.adminPassword && username === config.adminUsername && password === config.adminPassword) {
        const token = crypto.randomUUID();
        dbCreateSession(token);
        return new Response(null, { status: 303, headers: { Location: "/admin", "Set-Cookie": `admin_session=${token}; Path=/; HttpOnly; SameSite=Lax` } });
      }
      return loginPage("Invalid username or password.");
    },

    "/admin/logout": req => {
      if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });
      const token = parseCookie(req, "admin_session");
      if (token) dbDeleteSession(token);
      return new Response(null, { status: 303, headers: { Location: "/admin/login", "Set-Cookie": "admin_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0" } });
    },

    // Static built assets
    "/static/*": req => {
      const url = new URL(req.url);
      const file = Bun.file("public" + url.pathname.slice(7));
      return new Response(file);
    },

    // API — public
    "/api/status": req => {
      const isAdm = checkAdmin(req);
      return handleApiStatus(req, new URL(req.url), isAdm);
    },

    // API — admin only
    "/api/logs/*": req => {
      if (!checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      try { return handleApiLogs(req, new URL(req.url), true); }
      catch (e: any) { return Response.json({ error: String(e?.message || e) }, { status: 500 }); }
    },
    "/api/logs": req => {
      const isAdm = checkAdmin(req);
      try { return handleApiLogs(req, new URL(req.url), isAdm); }
      catch (e: any) { return Response.json({ error: String(e?.message || e) }, { status: 500 }); }
    },
    "/api/analytics": req => handleApiAnalytics(checkAdmin(req)),
    "/api/sessions/*": req => {
      const user = new URL(req.url).pathname.slice("/api/sessions/".length);
      return handleApiSessions(decodeURIComponent(user));
    },
    "/api/mind":          () => handleApiMind(),
    "/api/race":          () => handleApiRace(),
    "/api/version":       () => Response.json({ version: APP_VERSION }),
    "/api/usage/hourly":  () => handleApiUsageHourly(),
    "/api/admin/test": req => {
      if (!checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      return handleApiTest();
    },
    "/api/admin/credentials": req => {
      if (!checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      return handleAuthStatus();
    },
    "/api/admin/credentials/remove": async req => {
      if (!checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      return handleAuthRemove(req);
    },
    "/admin/auth/start": req => {
      if (!checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      return handleAuthStart(req);
    },
    "/admin/auth/exchange": async req => {
      if (!checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      return handleAuthExchange(req);
    },
    "/api/stats": req => {
      if (!checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      return handleApiStats();
    },
    // Chat moderation
    "/admin/chat/clear": req => {
      if (!checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      chatStore.splice(0, chatStore.length);
      broadcastRaw(JSON.stringify({ type: "chat_clear" }));
      broadcastChatMsg({ id: crypto.randomUUID(), type: "system", nick: "system", text: "🗑️ Chat cleared by admin", ts: Date.now() });
      return Response.json({ ok: true });
    },
    "/admin/chat/block": async req => {
      if (!checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      const { nick } = await req.json() as any;
      const n = String(nick || "").trim();
      if (!n) return Response.json({ error: "Missing nick" }, { status: 400 });
      chatBlocklist.add(n.toLowerCase());
      broadcastChatMsg({ id: crypto.randomUUID(), type: "system", nick: "system", text: `🚫 ${n} has been blocked`, ts: Date.now() });
      return Response.json({ ok: true });
    },
    "/admin/chat/unblock": async req => {
      if (!checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      const { nick } = await req.json() as any;
      const n = String(nick || "").trim();
      chatBlocklist.delete(n.toLowerCase());
      broadcastChatMsg({ id: crypto.randomUUID(), type: "system", nick: "system", text: `✅ ${n} has been unblocked`, ts: Date.now() });
      return Response.json({ ok: true });
    },
    "/admin/chat/blocked": req => {
      if (!checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      return Response.json({ blocked: [...chatBlocklist] });
    },

    "/api/admin/db/info": req => {
      if (!checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      return handleDbInfo();
    },
    "/api/admin/db/download": req => {
      if (!checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      return handleDbDownload();
    },
    "/api/admin/db/upload": async req => {
      if (!checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      return handleDbUpload(req);
    },

    // Admin actions
    "/admin/reset":              req => { if (!checkAdmin(req)) return new Response(null, { status: 303, headers: { Location: "/admin/login" } }); return handleAdmin(req, new URL(req.url)); },
    "/admin/logs/clear":         req => { if (!checkAdmin(req)) return new Response(null, { status: 303, headers: { Location: "/admin/login" } }); return handleAdmin(req, new URL(req.url)); },
    "/admin/token/add":          req => { if (!checkAdmin(req)) return new Response(null, { status: 303, headers: { Location: "/admin/login" } }); return handleAdmin(req, new URL(req.url)); },
    "/admin/token/edit":         req => { if (!checkAdmin(req)) return new Response(null, { status: 303, headers: { Location: "/admin/login" } }); return handleAdmin(req, new URL(req.url)); },
    "/admin/token/edit-all":     req => { if (!checkAdmin(req)) return new Response(null, { status: 303, headers: { Location: "/admin/login" } }); return handleAdmin(req, new URL(req.url)); },
    "/admin/token/pause":        req => { if (!checkAdmin(req)) return new Response(null, { status: 303, headers: { Location: "/admin/login" } }); return handleAdmin(req, new URL(req.url)); },
    "/admin/token/delete":       req => { if (!checkAdmin(req)) return new Response(null, { status: 303, headers: { Location: "/admin/login" } }); return handleAdmin(req, new URL(req.url)); },

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
    "/api/*": () => Response.json({ error: "Not found" }, { status: 404 }),
    "/v1/*":  () => Response.json({ error: { type: "not_found_error", message: "Unknown endpoint" } }, { status: 404 }),
  },

});

console.log(`claude-proxy v2 :${server.port} ready`);
