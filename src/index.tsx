import { serve, type ServerWebSocket } from "bun";
import fs from "node:fs";
import path from "node:path";

const APP_VERSION: string = JSON.parse(
  fs.readFileSync(path.join(import.meta.dir, "../package.json"), "utf8")
).version;
import { config }           from "./config";
import { loadFromDb, backfillUsers, onShutdown, tokens, users, upstream, dailyUsage, totalTokensAllTime, allTimePerUser, dbCreateSession, dbCheckSession, dbDeleteSession, modelRoutes, settings } from "./state";
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
import { handleApiUsers }  from "./handlers/apiUsers";
import { handleApiModelRoutes } from "./handlers/apiModelRoutes";
import { handleProxy }     from "./handlers/proxy";
import { _broadcast, _broadcastSystemMsg } from "./broadcast";

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
      label:     isAdmin ? k : tk.name,
      name:      tk.name,
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
  return new Response(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>claude-proxy · Admin</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}

:root{
  --bg:#0f1012;
  --surface:#1a1b1e;
  --border:#2c2e33;
  --border-focus:#339af0;
  --text:#c9cace;
  --text-dim:#636770;
  --text-bright:#e9eaec;
  --blue:#228be6;
  --blue-hover:#1c7ed6;
  --red:#fa5252;
  --red-bg:rgba(250,82,82,.1);
  --input-bg:#25262b;
}
@media(prefers-color-scheme:light){
  :root{
    --bg:#f0f2f5;
    --surface:#fff;
    --border:#dee2e6;
    --border-focus:#228be6;
    --text:#1c1c1e;
    --text-dim:#868e96;
    --text-bright:#000;
    --input-bg:#f8f9fa;
  }
}

body{
  font-family:ui-monospace,SFMono-Regular,"SF Mono",Menlo,monospace;
  min-height:100vh;
  background:var(--bg);
  color:var(--text);
  display:grid;
  place-items:center;
  padding:16px;
}

.wrap{width:100%;max-width:400px}

/* ── Brand ── */
.brand{display:flex;align-items:center;gap:12px;margin-bottom:32px;justify-content:center}
.logo{
  width:44px;height:44px;
  background:var(--blue);
  border-radius:12px;
  display:flex;align-items:center;justify-content:center;
  flex-shrink:0;
}
.logo span{color:#fff;font-size:.8rem;font-weight:800;letter-spacing:.02em}
.brand-text{}
.brand-name{font-size:1.05rem;font-weight:700;color:var(--text-bright);letter-spacing:.04em}
.brand-sub{font-size:.72rem;color:var(--text-dim);margin-top:1px}

/* ── Card ── */
.card{
  background:var(--surface);
  border:1px solid var(--border);
  border-radius:16px;
  padding:28px 28px 24px;
  box-shadow:0 4px 24px rgba(0,0,0,.18);
}

.card-title{font-size:.95rem;font-weight:700;color:var(--text-bright);margin-bottom:4px}
.card-desc{font-size:.78rem;color:var(--text-dim);margin-bottom:24px;line-height:1.5}

/* ── Error ── */
.error{
  display:flex;align-items:center;gap:8px;
  background:var(--red-bg);
  border:1px solid rgba(250,82,82,.3);
  border-radius:8px;
  padding:10px 12px;
  margin-bottom:16px;
  font-size:.8rem;
  color:var(--red);
}
.error-icon{font-size:.9rem;flex-shrink:0}

/* ── Form ── */
.field{margin-bottom:16px}
.field:last-of-type{margin-bottom:20px}
label{
  display:block;
  font-size:.7rem;
  font-weight:700;
  color:var(--text-dim);
  text-transform:uppercase;
  letter-spacing:.07em;
  margin-bottom:7px;
}
input{
  width:100%;
  padding:10px 12px;
  background:var(--input-bg);
  border:1px solid var(--border);
  border-radius:8px;
  font-size:.875rem;
  font-family:inherit;
  color:var(--text-bright);
  outline:none;
  transition:border-color .15s,box-shadow .15s;
}
input::placeholder{color:var(--text-dim);opacity:.7}
input:focus{border-color:var(--border-focus);box-shadow:0 0 0 3px rgba(51,154,240,.12)}

/* ── Button ── */
button{
  width:100%;
  padding:11px;
  background:var(--blue);
  color:#fff;
  border:none;
  border-radius:8px;
  font-size:.875rem;
  font-weight:600;
  cursor:pointer;
  font-family:inherit;
  letter-spacing:.02em;
  transition:background .15s,opacity .15s;
  display:flex;align-items:center;justify-content:center;gap:8px;
}
button:hover{background:var(--blue-hover)}
button:active{opacity:.85}
button:disabled{opacity:.6;cursor:not-allowed}

/* ── Divider ── */
.divider{border:none;border-top:1px solid var(--border);margin:20px 0}

/* ── Footer ── */
.footer{
  margin-top:16px;
  display:flex;align-items:center;justify-content:space-between;
  font-size:.7rem;color:var(--text-dim);
}
.footer a{color:var(--text-dim);text-decoration:none}
.footer a:hover{color:var(--text)}
.dot{width:5px;height:5px;border-radius:50%;background:var(--text-dim);display:inline-block;margin-right:6px;vertical-align:middle}

/* ── Info strip ── */
.info{
  margin-top:12px;
  font-size:.7rem;
  color:var(--text-dim);
  line-height:1.6;
  display:flex;
  align-items:flex-start;
  gap:7px;
}
.info-icon{flex-shrink:0;margin-top:1px}
</style>
</head>
<body>
<div class="wrap">

  <!-- Brand -->
  <div class="brand">
    <div class="logo"><span>CP</span></div>
    <div class="brand-text">
      <div class="brand-name">claude-proxy</div>
      <div class="brand-sub">Admin Dashboard</div>
    </div>
  </div>

  <!-- Card -->
  <div class="card">
    <div class="card-title">Sign in</div>
    <div class="card-desc">Enter your credentials to access the admin panel.</div>

    ${error ? `
    <div class="error">
      <span class="error-icon">⚠</span>
      <span>${error}</span>
    </div>` : ""}

    <form method="POST" action="/admin/login" id="form">
      <div class="field">
        <label for="u">Username</label>
        <input id="u" type="text" name="username" autocomplete="username"
          autofocus required placeholder="admin">
      </div>
      <div class="field">
        <label for="p">Password</label>
        <input id="p" type="password" name="password" autocomplete="current-password"
          required placeholder="••••••••">
      </div>
      <button type="submit" id="btn">
        <span id="btn-label">Sign in</span>
      </button>
    </form>

    <hr class="divider">

    <div class="info">
      <span class="info-icon">🔒</span>
      <span>Session lasts 30 days. Admin key or username/password required.
      Credentials are set via <code>ADMIN_USERNAME</code> and <code>ADMIN_PASSWORD</code> env vars.</span>
    </div>
  </div>

  <!-- Footer -->
  <div class="footer">
    <span><span class="dot"></span>claude-proxy</span>
    <a href="/">← Public view</a>
  </div>

</div>
<script>
  document.getElementById("form").addEventListener("submit", function() {
    const btn = document.getElementById("btn");
    const label = document.getElementById("btn-label");
    btn.disabled = true;
    label.textContent = "Signing in…";
  });
</script>
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
    "/api/admin/test/deepseek": req => {
      if (!checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      return handleDeepSeekTest();
    },
    "/api/admin/test/openrouter": req => {
      if (!checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      return handleOpenRouterTest();
    },
    "/api/admin/settings": req => {
      if (!checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      return Response.json(settings);
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

    // Users API (admin only)
    "/api/admin/users": async req => {
      if (!checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      return handleApiUsers(req, new URL(req.url), users, tokens, dailyUsage, allTimePerUser);
    },
    "/api/admin/users/*": async req => {
      if (!checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      return handleApiUsers(req, new URL(req.url), users, tokens, dailyUsage, allTimePerUser);
    },

    // Model routing (admin only)
    "/api/admin/model-routes": async req => {
      if (!checkAdmin(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      return handleApiModelRoutes(req, new URL(req.url));
    },

    // Admin actions
    "/admin/reset":              req => { if (!checkAdmin(req)) return new Response(null, { status: 303, headers: { Location: "/admin/login" } }); return handleAdmin(req, new URL(req.url)); },
    "/admin/logs/clear":         req => { if (!checkAdmin(req)) return new Response(null, { status: 303, headers: { Location: "/admin/login" } }); return handleAdmin(req, new URL(req.url)); },
    "/admin/token/add":          req => { if (!checkAdmin(req)) return new Response(null, { status: 303, headers: { Location: "/admin/login" } }); return handleAdmin(req, new URL(req.url)); },
    "/admin/token/edit":         req => { if (!checkAdmin(req)) return new Response(null, { status: 303, headers: { Location: "/admin/login" } }); return handleAdmin(req, new URL(req.url)); },
    "/admin/token/edit-all":     req => { if (!checkAdmin(req)) return new Response(null, { status: 303, headers: { Location: "/admin/login" } }); return handleAdmin(req, new URL(req.url)); },
    "/admin/token/pause":        req => { if (!checkAdmin(req)) return new Response(null, { status: 303, headers: { Location: "/admin/login" } }); return handleAdmin(req, new URL(req.url)); },
    "/admin/token/delete":       req => { if (!checkAdmin(req)) return new Response(null, { status: 303, headers: { Location: "/admin/login" } }); return handleAdmin(req, new URL(req.url)); },
    "/admin/token/rotate":       req => { if (!checkAdmin(req)) return new Response(null, { status: 303, headers: { Location: "/admin/login" } }); return handleAdmin(req, new URL(req.url)); },
    "/admin/token/rename":       req => { if (!checkAdmin(req)) return new Response(null, { status: 303, headers: { Location: "/admin/login" } }); return handleAdmin(req, new URL(req.url)); },
    "/admin/token/provider":     req => { if (!checkAdmin(req)) return new Response(null, { status: 303, headers: { Location: "/admin/login" } }); return handleAdmin(req, new URL(req.url)); },
    "/admin/user/edit":          req => { if (!checkAdmin(req)) return new Response(null, { status: 303, headers: { Location: "/admin/login" } }); return handleAdmin(req, new URL(req.url)); },
    "/admin/users/purge-orphans": req => { if (!checkAdmin(req)) return new Response(null, { status: 303, headers: { Location: "/admin/login" } }); return handleAdmin(req, new URL(req.url)); },
    "/admin/settings/deepseek":    req => { if (!checkAdmin(req)) return new Response(null, { status: 303, headers: { Location: "/admin/login" } }); return handleAdmin(req, new URL(req.url)); },
    "/admin/settings/openrouter": req => { if (!checkAdmin(req)) return new Response(null, { status: 303, headers: { Location: "/admin/login" } }); return handleAdmin(req, new URL(req.url)); },

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
