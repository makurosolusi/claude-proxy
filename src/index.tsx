import { serve, type ServerWebSocket } from "bun";
import index from "./index.html";
import { config }           from "./config";
import { loadFromDb, onShutdown, tokens, upstream, dailyUsage, dbCreateSession, dbCheckSession, dbDeleteSession } from "./state";
import { initFromEnv, todayKey, maskToken } from "./tokens";
import { startPoller }     from "./upstream";
import { handleApiStatus } from "./handlers/apiStatus";
import { handleApiLogs }   from "./handlers/apiLogs";
import { handleApiStats }  from "./handlers/apiStats";
import { handleApiMind }   from "./handlers/apiMind";
import { handleApiTest }   from "./handlers/apiTest";
import { handleAuthLogin, handleAuthStatus, handleAuthRemove } from "./handlers/apiAuth";
import { handleAdmin }     from "./handlers/admin";
import { handleProxy }     from "./handlers/proxy";
import { _broadcast }      from "./broadcast";

// ── Boot ─────────────────────────────────────────────────────────────────────
loadFromDb();
initFromEnv();
process.on("SIGTERM", () => onShutdown("SIGTERM"));
process.on("SIGINT",  () => onShutdown("SIGINT"));
startPoller();

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
      label:     isAdmin ? k : maskToken(k),
      used:      tk.used,
      limit:     tk.limit === Infinity ? null : tk.limit,
      remaining: tk.limit === Infinity ? null : Math.max(0, tk.limit - tk.used),
      pct:       tk.limit === Infinity ? 0 : Math.round((tk.used / tk.limit) * 100),
      paused:    tk.paused,
      today:     (dailyUsage[today] || {})[k] || 0,
    };
  }
  return {
    ts:      new Date().toISOString(),
    pollAge: upstream.lastPoll ? fmtCd(now - upstream.lastPoll) + " ago" : "pending",
    isAdmin,
    tokens:  tokenData,
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
    },
    close(ws: ServerWebSocket<WsData>) {
      wsClients.delete(ws);
    },
    message() {},
  },

  error(err: Error) {
    console.error("[server error]", err);
    return new Response(`<!doctype html><html><head><title>500</title><style>body{font-family:monospace;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#1a1b1e;color:#c1c2c5}.box{text-align:center}.code{font-size:4rem;font-weight:700;color:#fa5252;margin:0}.msg{color:#868e96;margin-top:8px}</style></head><body><div class="box"><p class="code">500</p><p class="msg">Internal server error</p></div></body></html>`, { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } });
  },

  routes: {
    // Frontend — React SPA handles all UI
    "/*": index,

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
    "/api/mind": () => handleApiMind(),
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
    "/admin/auth/login": req => {
      if (!checkAdmin(req)) return new Response(null, { status: 303, headers: { Location: "/admin/login" } });
      return handleAuthLogin(req);
    },
    "/api/stats": req => {
      if (!checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      return handleApiStats();
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

  development: process.env.NODE_ENV !== "production" && {
    hmr: true,
    console: true,
  },
});

console.log(`claude-proxy v2 :${server.port} ready`);
