import { tokens, users, db, dbInsertToken, dbUpdateToken, dbSoftDelete, dbResetToken, dbClearLogs, dbRenameToken, dbUpsertUser, dbLinkTokenToUser, dbUpdateUser, dbSaveSetting, dbUpdateProvider, deriveNameFromKey, slugify, ensureUniqueSlug, settings } from "../state";
import type { TokenProvider } from "../types";
import { clearInFlight, bumpGeneration } from "../tokens";
import { config }  from "../config";
import { triggerBroadcast } from "../broadcast";
import type { TokenEntry } from "../types";

async function parseForm(req: Request): Promise<FormData | null> {
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/x-www-form-urlencoded") || ct.includes("multipart/form-data")) {
    return req.formData();
  }
  return null;
}

function redirect(): Response {
  triggerBroadcast();
  return Response.json({ ok: true });
}

export async function handleAdmin(req: Request, url: URL): Promise<Response> {
  const pathname = url.pathname;
  const form     = await parseForm(req);

  // Reset usage
  if (pathname === "/admin/reset") {
    const target = form ? String(form.get("token") || "") : url.searchParams.get("token");
    const all    = form ? form.get("all") === "true" : url.searchParams.get("all") === "true";
    const now    = Date.now();
    if (all) {
      for (const [k, tk] of Object.entries(tokens)) {
        tk.used = 0; tk.windowStart = now;
        dbResetToken(k, now);
        bumpGeneration(k);  // invalidate all in-flight incrementUsage calls
      }
      clearInFlight();
    } else if (target && tokens[target]) {
      tokens[target].used = 0; tokens[target].windowStart = now;
      dbResetToken(target, now);
      bumpGeneration(target);  // invalidate pre-reset streaming increments
      clearInFlight(target);
    } else {
      return new Response("Token not found\n", { status: 404 });
    }
    return redirect();
  }

  // Add token
  if (pathname === "/admin/token/add" && req.method === "POST") {
    const newKey    = String(form?.get("token")   || "").trim();
    const newLimit  = String(form?.get("limit")   || "40000").trim();
    const userId    = String(form?.get("user_id") || "").trim(); // optional existing user
    if (!newKey)        return new Response("Key required\n",          { status: 400 });
    if (tokens[newKey]) return new Response("Token already exists\n", { status: 409 });
    const parsed     = newLimit === "unlimited" ? Infinity : parseInt(newLimit);
    const customName = String(form?.get("name") || "").trim();
    const displayName = customName || deriveNameFromKey(newKey);

    // Resolve or create user
    let uid = userId && users[userId] ? userId : "";
    if (!uid) {
      uid = ensureUniqueSlug(slugify(displayName), users);
      if (!users[uid]) {
        const userEntry = { id: uid, name: displayName, email: "", description: "", created_at: Date.now(), role: "USER" as const };
        users[uid] = userEntry;
        dbUpsertUser(userEntry);
      }
    }

    const entry: TokenEntry = {
      limit: parsed, window: config.windowMs,
      used: 0, windowStart: Date.now(), paused: false, dynamic: true, mode: "inherit", provider: "inherit",
      name: users[uid]?.name ?? displayName,
      user_id: uid,
    };
    tokens[newKey] = entry;
    dbInsertToken(newKey, entry);
    return redirect();
  }

  // Edit single token limit
  if (pathname === "/admin/token/edit" && req.method === "POST") {
    const target   = String(form?.get("token") || "").trim();
    const newLimit = String(form?.get("limit")  || "").trim();
    if (!target || !tokens[target]) return new Response("Token not found\n", { status: 404 });
    const parsed = newLimit === "unlimited" ? Infinity : parseInt(newLimit);
    if (isNaN(parsed) && newLimit !== "unlimited") return new Response("Invalid limit\n", { status: 400 });
    tokens[target].limit = parsed;
    dbUpdateToken(target, tokens[target]);
    return redirect();
  }

  // Edit all token limits
  if (pathname === "/admin/token/edit-all" && req.method === "POST") {
    const newLimit = String(form?.get("limit") || "").trim();
    const parsed   = newLimit === "unlimited" ? Infinity : parseInt(newLimit);
    if (isNaN(parsed) && newLimit !== "unlimited") return new Response("Invalid limit\n", { status: 400 });
    for (const [k, tk] of Object.entries(tokens)) {
      tk.limit = parsed;
      dbUpdateToken(k, tk);
    }
    return redirect();
  }

  // Pause / resume
  if (pathname === "/admin/token/pause" && req.method === "POST") {
    const target   = String(form?.get("token") || "").trim();
    const pauseAll = form?.get("all") === "true";
    if (pauseAll) {
      const all = Object.values(tokens).every(tk => tk.paused);
      for (const [k, tk] of Object.entries(tokens)) {
        tk.paused = !all;
        dbUpdateToken(k, tk);
      }
    } else {
      if (!target || !tokens[target]) return new Response("Token not found\n", { status: 404 });
      tokens[target].paused = !tokens[target].paused;
      dbUpdateToken(target, tokens[target]);
    }
    return redirect();
  }

  // Delete token
  if (pathname === "/admin/token/delete" && req.method === "POST") {
    const target = String(form?.get("token") || "").trim();
    if (!target || !tokens[target]) return new Response("Token not found\n", { status: 404 });
    dbSoftDelete(target);
    delete tokens[target];
    return redirect();
  }

  // Rename token display name
  if (pathname === "/admin/token/rename" && req.method === "POST") {
    const target  = String(form?.get("token") || "").trim();
    const newName = String(form?.get("name")  || "").trim();
    if (!target || !tokens[target]) return new Response("Token not found\n", { status: 404 });
    if (!newName)                   return new Response("Name required\n",   { status: 400 });
    tokens[target].name = newName;
    dbRenameToken(target, newName);
    return redirect();
  }

  // Rotate token — create new key, soft-delete old
  if (pathname === "/admin/token/rotate" && req.method === "POST") {
    const target     = String(form?.get("token")   || "").trim();
    const newKeyRaw  = String(form?.get("new_key") || "").trim();
    if (!target || !tokens[target]) return new Response("Token not found\n", { status: 404 });
    const old = tokens[target];
    // Auto-generate if new_key not provided
    const newKey = newKeyRaw || `${target}-${Math.random().toString(16).slice(2, 6)}`;
    if (tokens[newKey]) return new Response("New key already exists\n", { status: 409 });
    const entry: TokenEntry = {
      ...old,
      used:        0,
      windowStart: Date.now(),
      user_id:     old.user_id,
    };
    tokens[newKey] = entry;
    dbInsertToken(newKey, entry);
    dbSoftDelete(target);
    bumpGeneration(target);
    clearInFlight(target);
    delete tokens[target];
    return Response.json({ ok: true, newKey });
  }

  // Set per-token provider
  if (pathname === "/admin/token/provider" && req.method === "POST") {
    const target   = String(form?.get("token")    || "").trim();
    const provider = String(form?.get("provider") || "inherit").trim() as TokenProvider;
    if (!target || !tokens[target]) return new Response("Token not found\n", { status: 404 });
    const valid: TokenProvider[] = ["inherit", "anthropic", "deepseek", "openrouter"];
    if (!valid.includes(provider)) return new Response("Invalid provider\n", { status: 400 });

    // Guard: reject switch to provider that has no API key configured.
    // Prevents 503 loop when admin switches a token to an unconfigured provider.
    if (provider === "deepseek" && !settings["deepseek_api_key"]) {
      return Response.json({ ok: false, error: "DeepSeek API key not configured. Set it in Credentials first." }, { status: 400 });
    }
    if (provider === "openrouter" && !settings["openrouter_api_key"]) {
      return Response.json({ ok: false, error: "OpenRouter API key not configured. Set it in Credentials first." }, { status: 400 });
    }

    tokens[target].provider = provider;
    dbUpdateProvider(target, provider);
    return redirect();
  }

  // Set email on user (for Google OAuth mapping)
  if (pathname === "/admin/user/set-email" && req.method === "POST") {
    const uid   = String(form?.get("user_id") || "").trim();
    const email = String(form?.get("email")   || "").trim();
    if (!uid || !users[uid]) return new Response("User not found\n", { status: 404 });
    if (!email || !email.includes("@")) return new Response("Valid email required\n", { status: 400 });
    // Check no other user has this email
    for (const [id, u] of Object.entries(users)) {
      if (u.email === email && id !== uid) return new Response("Email already assigned to another user\n", { status: 409 });
    }
    users[uid].email = email;
    db.query("UPDATE users SET email=? WHERE id=?").run(email, uid);
    return redirect();
  }

  // Edit user name / description (via admin panel without going through /api/admin/users)
  if (pathname === "/admin/user/edit" && req.method === "POST") {
    const uid     = String(form?.get("user_id")     || "").trim();
    const newName = String(form?.get("name")        || "").trim();
    const newDesc = String(form?.get("description") || "");
    if (!uid || !users[uid]) return new Response("User not found\n", { status: 404 });
    if (!newName)             return new Response("Name required\n",  { status: 400 });
    users[uid].name = newName;
    users[uid].description = newDesc;
    dbUpdateUser(uid, newName, newDesc);
    // Update active tokens' display names
    for (const [key, tk] of Object.entries(tokens)) {
      if (tk.user_id === uid) { tk.name = newName; db.query("UPDATE tokens SET name=? WHERE key=?").run(newName, key); }
    }
    return redirect();
  }

  // DeepSeek settings
  if (pathname === "/admin/settings/deepseek" && req.method === "POST") {
    const apiKey   = String(form?.get("api_key")   || "").trim();
    const baseUrl  = String(form?.get("base_url")  || "").trim();
    const model    = String(form?.get("model")     || "").trim();
    const override = String(form?.get("provider_override") || "");
    if (apiKey)   dbSaveSetting("deepseek_api_key", apiKey);
    if (baseUrl)  dbSaveSetting("deepseek_base_url", baseUrl);
    if (model)    dbSaveSetting("deepseek_model", model);
    dbSaveSetting("provider_override", override);
    return redirect();
  }

  // OpenRouter settings
  if (pathname === "/admin/settings/openrouter" && req.method === "POST") {
    const apiKey   = String(form?.get("api_key")   || "").trim();
    const baseUrl  = String(form?.get("base_url")  || "").trim();
    const model    = String(form?.get("model")     || "").trim();
    const override = String(form?.get("provider_override") || "");
    if (apiKey)   dbSaveSetting("openrouter_api_key", apiKey);
    if (baseUrl)  dbSaveSetting("openrouter_base_url", baseUrl);
    if (model)    dbSaveSetting("openrouter_model", model);
    dbSaveSetting("provider_override", override);
    return redirect();
  }

  // Purge orphan users — delete users with no tokens and whose id matches a duplicate name slug
  if (pathname === "/admin/users/purge-orphans" && req.method === "POST") {
    // Find users with no linked active tokens
    const tokenUserIds = new Set(Object.values(tokens).map(tk => tk.user_id).filter(Boolean));
    const orphans = Object.values(users).filter(u => !tokenUserIds.has(u.id));
    // Group orphans by name slug — keep none (they're all orphans), delete all
    let deleted = 0;
    for (const u of orphans) {
      db.query("DELETE FROM users WHERE id=?").run(u.id);
      delete users[u.id];
      deleted++;
    }
    triggerBroadcast();
    return Response.json({ ok: true, deleted });
  }

  // Clear logs
  if (pathname === "/admin/logs/clear" && req.method === "POST") {
    const user = form ? String(form.get("user") || "").trim() : "";
    dbClearLogs(user || undefined);
    return Response.json({ ok: true });
  }

  return new Response("Not found\n", { status: 404 });
}
