import fs   from "fs";
import path from "path";
import crypto from "crypto";
import { config }   from "../config";
import { upstream } from "../state";

const OAUTH_CLIENT_ID   = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const OAUTH_AUTH_URL    = "https://claude.ai/oauth/authorize";
const OAUTH_TOKEN_URL   = "https://api.anthropic.com/v1/oauth/token";
const CALLBACK_URI      = "http://localhost:54545/callback";
const SCOPES            = "user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload";
const PENDING_TTL_MS    = 10 * 60 * 1000;

interface PendingAuth { codeVerifier: string; ts: number; }
const pendingAuth = new Map<string, PendingAuth>();

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function emailFromJwt(token: string): string {
  try {
    const [, payload] = token.split(".");
    const obj = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
    return obj.email || obj.sub || "";
  } catch { return ""; }
}

async function resolveEmail(accessToken: string): Promise<string> {
  const jwtEmail = emailFromJwt(accessToken);
  if (jwtEmail && jwtEmail.includes("@")) return jwtEmail;
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
  if (jwtEmail) return jwtEmail;
  return `account-${Date.now()}`;
}

async function exchangeAndSave(code: string, codeVerifier: string, state: string): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  let tokenData: any;
  try {
    const resp = await fetch(OAUTH_TOKEN_URL, {
      method:  "POST",
      headers: {
        "Content-Type":    "application/json",
        "Accept":          "application/json",
        "Origin":          "https://claude.ai",
        "Referer":         "https://claude.ai/",
        "User-Agent":      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
      body: JSON.stringify({
        grant_type:    "authorization_code",
        client_id:     OAUTH_CLIENT_ID,
        code,
        redirect_uri:  CALLBACK_URI,
        code_verifier: codeVerifier,
        state,
      }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      console.error("[auth] Exchange failed:", resp.status, body);
      return { ok: false, error: `Token exchange HTTP ${resp.status}: ${body.slice(0, 300)}` };
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

  upstream.tokenCache = { value: null, readAt: 0, email: null };
  console.log(`[auth] Credential saved → ${safeFile}`);
  return { ok: true, email };
}

// ── Shared PKCE session builder ───────────────────────────────────────────────
function createPkceSession(): { authUrl: string } {
  const now = Date.now();
  for (const [k, v] of pendingAuth) {
    if (now - v.ts > PENDING_TTL_MS) pendingAuth.delete(k);
  }
  const codeVerifier  = base64url(crypto.randomBytes(32));
  const codeChallenge = base64url(Buffer.from(crypto.createHash("sha256").update(codeVerifier).digest()));
  const state         = crypto.randomUUID();
  pendingAuth.set(state, { codeVerifier, ts: now });

  const params = new URLSearchParams({
    response_type:          "code",
    client_id:              OAUTH_CLIENT_ID,
    redirect_uri:           CALLBACK_URI,
    scope:                  SCOPES,
    state,
    code_challenge:         codeChallenge,
    code_challenge_method:  "S256",
  });
  return { authUrl: OAUTH_AUTH_URL + "?" + params };
}

// ── Public handlers ───────────────────────────────────────────────────────────

// Returns JSON { authUrl } — used by admin UI for the manual paste flow
export function handleAuthStart(_req: Request): Response {
  const { authUrl } = createPkceSession();
  return Response.json({ authUrl });
}

// Receives the callback URL that the user copies from their browser address bar
// e.g. http://localhost:54545/callback?code=...&state=...
export async function handleAuthExchange(req: Request): Promise<Response> {
  const body = await req.json() as any;
  const callbackUrl = body?.callbackUrl as string | undefined;
  if (!callbackUrl) {
    return Response.json({ ok: false, error: "Missing callbackUrl" }, { status: 400 });
  }

  let code: string | null, state: string | null;
  try {
    const u     = new URL(callbackUrl);
    code        = u.searchParams.get("code");
    state       = u.searchParams.get("state");
    const oerr  = u.searchParams.get("error");
    if (oerr) return Response.json({ ok: false, error: `OAuth error: ${oerr}` });
  } catch {
    return Response.json({ ok: false, error: "Invalid URL — paste the full address bar URL" }, { status: 400 });
  }

  if (!code || !state) {
    return Response.json({ ok: false, error: "URL is missing code or state parameter" }, { status: 400 });
  }

  const pending = pendingAuth.get(state);
  if (!pending) {
    return Response.json({ ok: false, error: "State not found — session may have expired, start again" }, { status: 400 });
  }
  if (Date.now() - pending.ts > PENDING_TTL_MS) {
    pendingAuth.delete(state);
    return Response.json({ ok: false, error: "Session expired (10 min limit) — start again" }, { status: 400 });
  }
  pendingAuth.delete(state);

  const result = await exchangeAndSave(code, pending.codeVerifier, state);
  return result.ok
    ? Response.json({ ok: true, email: result.email })
    : Response.json({ ok: false, error: result.error }, { status: 400 });
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
