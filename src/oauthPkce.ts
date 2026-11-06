import crypto from "crypto";
import { config } from "./config";
import { resolveEmail, writeCredential } from "./credentialSave";

const OAUTH_CLIENT_ID   = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const OAUTH_AUTH_URL    = "https://claude.ai/oauth/authorize";
const OAUTH_TOKEN_URL   = "https://api.anthropic.com/v1/oauth/token";
const CALLBACK_URI      = `http://localhost:${config.oauthCallbackPort}/callback`;
const SCOPES            = "user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload";
const PENDING_TTL_MS    = 10 * 60 * 1000;

interface PendingAuth { codeVerifier: string; ts: number; }
const pendingAuth = new Map<string, PendingAuth>();

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/** Starts a PKCE session and returns the claude.ai authorize URL. */
export function createPkceSession(): { authUrl: string } {
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

/** Takes the pending PKCE session for `state` (one-shot), enforcing the TTL. */
export function consumePendingAuth(state: string): { ok: true; codeVerifier: string } | { ok: false; error: string } {
  const pending = pendingAuth.get(state);
  if (!pending) {
    return { ok: false, error: "State not found — session may have expired, start again" };
  }
  if (Date.now() - pending.ts > PENDING_TTL_MS) {
    pendingAuth.delete(state);
    return { ok: false, error: "Session expired (10 min limit) — start again" };
  }
  pendingAuth.delete(state);
  return { ok: true, codeVerifier: pending.codeVerifier };
}

/** Exchanges an authorization code for tokens and saves the credential file. */
export async function exchangeAndSave(code: string, codeVerifier: string, state: string): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
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

  const email = await resolveEmail(accessToken, tokenData);
  const saved = writeCredential(email, (existing, targetCreatedAt, now) => ({
    ...existing,
    access_token:  accessToken,
    refresh_token: refreshToken,
    email,
    expires_in:    tokenData.expires_in || null,
    updated_at:    now,
    created_at:    existing.created_at || targetCreatedAt || now,
    disabled:      false,
  }));
  if (!saved.ok) return saved;

  console.log(`[auth] Credential saved → ${saved.file}`);
  return { ok: true, email };
}
