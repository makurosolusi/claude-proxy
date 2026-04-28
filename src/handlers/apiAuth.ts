import fs   from "fs";
import path from "path";
import crypto from "crypto";
import { config }   from "../config";
import { upstream } from "../state";

const OAUTH_CLIENT_ID   = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const OAUTH_AUTH_URL    = "https://claude.ai/oauth/authorize";
const OAUTH_TOKEN_URL   = "https://api.anthropic.com/v1/oauth/token";
const CALLBACK_PORT     = 54545;
const CALLBACK_URI      = `http://localhost:${CALLBACK_PORT}/callback`;
const SCOPES            = "user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload";
const PENDING_TTL_MS    = 10 * 60 * 1000;

interface PendingAuth { codeVerifier: string; ts: number; }
const pendingAuth = new Map<string, PendingAuth>();

let callbackServer: ReturnType<typeof Bun.serve> | null = null;

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

// Attempt to extract email from JWT payload (no external deps needed)
function emailFromJwt(token: string): string {
  try {
    const [, payload] = token.split(".");
    const obj = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
    return obj.email || obj.sub || "";
  } catch { return ""; }
}

async function resolveEmail(accessToken: string): Promise<string> {
  // 1. Try JWT decode
  const jwtEmail = emailFromJwt(accessToken);
  if (jwtEmail && jwtEmail.includes("@")) return jwtEmail;

  // 2. Try Anthropic profile endpoint
  try {
    const r = await fetch("https://api.anthropic.com/api/auth/oauth/profile", {
      headers: { "Authorization": "Bearer " + accessToken, "anthropic-beta": "oauth-2025-04-20" },
    });
    if (r.ok) {
      const d = await r.json() as any;
      const e = d.email || d.login_email || "";
      if (e) return e;
    }
  } catch {}

  // 3. Fallback — use sub from JWT or timestamp
  if (jwtEmail) return jwtEmail;
  return `account-${Date.now()}`;
}

async function exchangeAndSave(code: string, codeVerifier: string): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  let tokenData: any;
  try {
    const resp = await fetch(OAUTH_TOKEN_URL, {
      method:  "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "claude-proxy/2.0" },
      body:    JSON.stringify({
        grant_type:    "authorization_code",
        code,
        redirect_uri:  CALLBACK_URI,
        client_id:     OAUTH_CLIENT_ID,
        code_verifier: codeVerifier,
      }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      return { ok: false, error: `Token exchange HTTP ${resp.status}: ${body.slice(0, 200)}` };
    }
    tokenData = await resp.json();
  } catch (e: any) {
    return { ok: false, error: "Network error: " + e.message };
  }

  const accessToken  = tokenData.access_token  as string;
  const refreshToken = tokenData.refresh_token as string;
  if (!accessToken || !refreshToken) {
    return { ok: false, error: "Response missing access_token or refresh_token" };
  }

  const email    = await resolveEmail(accessToken);
  const safeFile = `claude-${email.replace(/[^a-zA-Z0-9._-]/g, "_")}.json`;
  const filePath = path.join(config.authDir, safeFile);

  try {
    fs.mkdirSync(config.authDir, { recursive: true });
    let existing: any = {};
    if (fs.existsSync(filePath)) {
      try { existing = JSON.parse(fs.readFileSync(filePath, "utf-8")); } catch {}
    }
    const now = new Date().toISOString();
    fs.writeFileSync(filePath, JSON.stringify({
      ...existing,
      access_token:  accessToken,
      refresh_token: refreshToken,
      email,
      expires_in:    tokenData.expires_in || null,
      updated_at:    now,
      created_at:    existing.created_at || now,
      disabled:      false,
    }, null, 2), "utf-8");
  } catch (e: any) {
    return { ok: false, error: "Save failed: " + e.message };
  }

  // Bust credential cache so the next proxy request picks up the new cred
  upstream.tokenCache = { value: null, readAt: 0, email: null };
  console.log(`[auth] Credential saved → ${safeFile}`);
  return { ok: true, email };
}

function startCallbackServer() {
  if (callbackServer) return;
  callbackServer = Bun.serve({
    port: CALLBACK_PORT,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname !== "/callback") return new Response("Not found", { status: 404 });

      const code  = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const err   = url.searchParams.get("error");

      // Shut down after handling (delay so response can be sent first)
      setTimeout(() => { callbackServer?.stop(true); callbackServer = null; }, 800);

      if (err) {
        return new Response(callbackPage(false, "Cancelled", `OAuth error: ${err}`),
          { headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
      if (!code || !state) {
        return new Response(callbackPage(false, "Missing parameters", "Missing code or state in callback."),
          { headers: { "Content-Type": "text/html; charset=utf-8" } });
      }

      const pending = pendingAuth.get(state);
      if (!pending) {
        return new Response(callbackPage(false, "Invalid state", "State not found. Did the session expire?"),
          { headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
      if (Date.now() - pending.ts > PENDING_TTL_MS) {
        pendingAuth.delete(state);
        return new Response(callbackPage(false, "Session expired", "Please start the flow again from the admin panel."),
          { headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
      pendingAuth.delete(state);

      const result = await exchangeAndSave(code, pending.codeVerifier);
      if (result.ok) {
        return new Response(callbackPage(true, "Connected!", `Authenticated as ${result.email}.\nYou can close this tab and return to the admin panel.`),
          { headers: { "Content-Type": "text/html; charset=utf-8" } });
      } else {
        return new Response(callbackPage(false, "Error", result.error),
          { headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
    },
    error(e) {
      console.error("[auth] Callback server error:", e);
      return new Response("Internal error", { status: 500 });
    },
  });
  console.log(`[auth] Callback server on :${CALLBACK_PORT}`);
}

// ── Public handlers ───────────────────────────────────────────────────────────

export function handleAuthLogin(_req: Request): Response {
  const now = Date.now();
  for (const [k, v] of pendingAuth) {
    if (now - v.ts > PENDING_TTL_MS) pendingAuth.delete(k);
  }

  const codeVerifier  = base64url(crypto.randomBytes(32));
  const codeChallenge = base64url(Buffer.from(crypto.createHash("sha256").update(codeVerifier).digest()));
  const state         = crypto.randomUUID();
  pendingAuth.set(state, { codeVerifier, ts: now });

  startCallbackServer();

  const params = new URLSearchParams({
    response_type:          "code",
    client_id:              OAUTH_CLIENT_ID,
    redirect_uri:           CALLBACK_URI,
    scope:                  SCOPES,
    state,
    code_challenge:         codeChallenge,
    code_challenge_method:  "S256",
  });

  return new Response(null, { status: 302, headers: { Location: OAUTH_AUTH_URL + "?" + params } });
}

export function handleAuthStatus(): Response {
  try {
    const dir = config.authDir;
    if (!fs.existsSync(dir)) return Response.json({ credentials: [] });
    const files = fs.readdirSync(dir).filter((f: string) => f.startsWith("claude-") && f.endsWith(".json"));
    const credentials = files.flatMap((f: string) => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
        return [{ file: f, email: data.email || f, disabled: !!data.disabled, active: !!(data.access_token && data.refresh_token && !data.disabled) }];
      } catch { return []; }
    });
    return Response.json({ credentials });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

export async function handleAuthRemove(req: Request): Promise<Response> {
  const body = await req.json() as any;
  const file = body?.file as string | undefined;
  if (!file || !/^claude-[\w@._+-]+\.json$/.test(file)) {
    return Response.json({ error: "Invalid file name" }, { status: 400 });
  }
  const filePath = path.join(config.authDir, file);
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    data.disabled = true;
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    upstream.tokenCache = { value: null, readAt: 0, email: null };
    return Response.json({ ok: true });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

// ── Result page ───────────────────────────────────────────────────────────────
function callbackPage(success: boolean, title: string, message: string): string {
  const c = success ? "#37b24d" : "#fa5252";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · claude-proxy</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px;background:#1a1b1e;color:#c1c2c5}
.card{background:#25262b;border:1px solid #373a40;border-radius:16px;padding:40px 32px;width:100%;max-width:440px;text-align:center}
.icon{font-size:3rem;color:${c};margin-bottom:16px;line-height:1}
h1{font-size:1.25rem;font-weight:700;color:${c};margin-bottom:12px}
p{font-size:.875rem;color:#868e96;line-height:1.7;white-space:pre-line}
</style>
</head>
<body>
<div class="card">
<div class="icon">${success ? "✓" : "✗"}</div>
<h1>${title}</h1>
<p>${message}</p>
</div>
</body>
</html>`;
}
