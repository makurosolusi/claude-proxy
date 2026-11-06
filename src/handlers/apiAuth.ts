import { config }   from "../config";
import { settings } from "../state";
import { bustCredentialCaches, getOauthCredential } from "../upstream";
import { listCredentials, setCredentialDisabled }   from "../anthropicAccounts";
import { getCredentialLastUsed } from "../credentialUsage";
import { createPkceSession, consumePendingAuth, exchangeAndSave } from "../oauthPkce";
import { resolveEmail, writeCredential } from "../credentialSave";

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

  const pending = consumePendingAuth(state);
  if (!pending.ok) return Response.json({ ok: false, error: pending.error }, { status: 400 });

  const result = await exchangeAndSave(code, pending.codeVerifier, state);
  return result.ok
    ? Response.json({ ok: true, email: result.email })
    : Response.json({ ok: false, error: result.error }, { status: 400 });
}

export function handleAuthStatus(): Response {
  const pinnedEmail  = settings["anthropic_account"] || "";
  const servingEmail = getOauthCredential()?.email ?? null;
  const lastUsed     = getCredentialLastUsed();
  const credentials = listCredentials(config.authDir).map(r => ({
    file:     r.file,
    email:    r.email,
    disabled: r.disabled,
    active:   r.usable,                       // frozen contract: "has usable tokens"
    pinned:   r.email === pinnedEmail,
    serving:  r.email === servingEmail,
    label:          r.label,
    created_at:     r.created_at,
    last_refresh:   r.last_refresh,
    last_used_at:   lastUsed[r.file] ?? null,
    email_resolved: r.email.includes("@"),
  }));
  return Response.json({ credentials, pinned_email: pinnedEmail, serving_email: servingEmail });
}

// Import an existing claude-*.json credential by pasting its JSON content directly.
// Useful for migrating credentials from another machine without redoing OAuth.
export async function handleAuthImport(req: Request): Promise<Response> {
  let body: any;
  try { body = await req.json(); }
  catch { return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 }); }

  // Accept either the credential object directly, or wrapped as { content: "<json string>" }
  let cred = body;
  if (typeof body?.content === "string") {
    try { cred = JSON.parse(body.content); }
    catch { return Response.json({ ok: false, error: "content field is not valid JSON" }, { status: 400 }); }
  }

  const accessToken  = String(cred?.access_token  || "").trim();
  const refreshToken = String(cred?.refresh_token || "").trim();
  let   email        = String(cred?.email         || "").trim();

  if (!accessToken || !refreshToken) {
    return Response.json({ ok: false, error: "access_token and refresh_token are required" }, { status: 400 });
  }

  if (!email || !email.includes("@")) {
    email = await resolveEmail(accessToken);
  }

  const saved = writeCredential(email, (existing, targetCreatedAt, now) => ({
    ...existing,
    access_token:  accessToken,
    refresh_token: refreshToken,
    email,
    expires_in:    cred.expires_in || existing.expires_in || null,
    created_at:    existing.created_at || targetCreatedAt || cred.created_at || now,
    updated_at:    now,
    imported_at:   now,
    disabled:      false,
  }));
  if (!saved.ok) return Response.json({ ok: false, error: saved.error }, { status: 500 });

  console.log(`[auth] Credential imported → ${saved.file}`);
  return Response.json({ ok: true, email, file: saved.file });
}

export async function handleAuthRemove(req: Request): Promise<Response> {
  const body = await req.json() as any;
  const file = body?.file as string | undefined;
  if (!file) return Response.json({ error: "Invalid file name" }, { status: 400 });

  const res = setCredentialDisabled(config.authDir, file, true);
  if (!res.ok) return Response.json({ error: res.error }, { status: res.badName ? 400 : 500 });

  bustCredentialCaches();
  return Response.json({ ok: true });
}
