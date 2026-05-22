import { randomBytes } from "crypto";
import { prisma } from "../prisma";
import { users, tokens, dbUpsertUser, dbInsertToken, slugify, ensureUniqueSlug } from "../state";
import { config } from "../config";
import type { TokenEntry } from "../types";

function generateApiKey(): string {
  return "sk-cp-" + randomBytes(24).toString("base64url");
}

// HMAC-SHA256 sign cookie value in Better Auth's expected format.
// Format mirrors better-call/dist/crypto.mjs: `${value}.${base64(signature)}`
// then URL-encoded. Must match exactly so auth.api.getSession can verify.
async function signSessionCookie(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sigBuf)));
  return encodeURIComponent(`${value}.${sigB64}`);
}

export async function handleDevLogin(req: Request): Promise<Response> {
  // Guard 1: env var must be set (production never sets this)
  const secret = process.env.DEV_LOGIN_SECRET;
  if (!secret) return new Response("Not found", { status: 404 });
  // Guard 2: header must match
  if (req.headers.get("x-dev-secret") !== secret) {
    return new Response("Forbidden", { status: 403 });
  }
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let body: any;
  try { body = await req.json(); } catch { body = {}; }
  const email = String(body?.email || "").trim().toLowerCase();
  if (!email) return Response.json({ error: "email required" }, { status: 400 });
  const displayName = String(body?.name || "").trim() || email.split("@")[0];

  // 1. Find or create Better Auth user record (the `user` table)
  let baUser = await prisma.user.findFirst({ where: { email } });
  if (!baUser) {
    baUser = await prisma.user.create({
      data: {
        id: crypto.randomUUID(),
        name: displayName,
        email,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
  }

  // 2. Find or create app user (the `users` table), auto-approved for dev
  let appUser = Object.values(users).find(u => u.email?.toLowerCase() === email);
  if (!appUser) {
    const id = ensureUniqueSlug(slugify(displayName), users);
    const isSuper = config.superAdminEmails.has(email);
    appUser = {
      id, name: displayName, email, description: "",
      created_at: Date.now(),
      role:   isSuper ? "SUPER_ADMIN" : "USER",
      status: "approved",
    };
    users[id] = appUser;
    await dbUpsertUser(appUser);

    // Default token so they can hit /v1/messages immediately
    const tokenKey = generateApiKey();
    const tokenEntry: TokenEntry = {
      limit: config.defaultTokenLimit,
      window: config.windowMs,
      used: 0, windowStart: Date.now(),
      paused: false, dynamic: true,
      mode: "inherit", provider: "inherit",
      user_id: id,
      label: "", description: "", pinned_model: "",
      last_reset: 0,
    };
    tokens[tokenKey] = tokenEntry;
    await dbInsertToken(tokenKey, tokenEntry);
  }

  // 3. Create Better Auth session row
  const sessionToken = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await prisma.session.create({
    data: {
      id: crypto.randomUUID(),
      token: sessionToken,
      userId: baUser.id,
      expiresAt,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  // 4. Build cookie. Cookie name has __Secure- prefix on HTTPS.
  const baseUrl = config.betterAuthUrl || `http://localhost:${config.port}`;
  const isHttps = baseUrl.startsWith("https://");
  const cookieName = isHttps ? "__Secure-better-auth.session_token" : "better-auth.session_token";
  const cookieValue = config.betterAuthSecret
    ? await signSessionCookie(sessionToken, config.betterAuthSecret)
    : encodeURIComponent(sessionToken);

  const maxAge = 30 * 24 * 60 * 60;
  const parts = [`${cookieName}=${cookieValue}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAge}`];
  if (isHttps) parts.push("Secure");

  const hostname = (() => { try { return new URL(baseUrl).hostname; } catch { return "localhost"; } })();

  // Response includes Playwright-ready cookie object so callers can pipe it
  // directly into `page.context().addCookies([cookie])`.
  return new Response(JSON.stringify({
    ok: true,
    user: { id: appUser.id, email: appUser.email, name: appUser.name, role: appUser.role, status: appUser.status },
    cookie: {
      name: cookieName,
      value: cookieValue,
      domain: hostname,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      secure: isHttps,
      expires: Math.floor(expiresAt.getTime() / 1000),
    },
  }), {
    headers: {
      "content-type": "application/json",
      "set-cookie": parts.join("; "),
    },
  });
}
