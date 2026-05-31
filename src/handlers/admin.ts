import { tokens, users, dbInsertToken, dbUpdateToken, dbSoftDelete, dbResetToken, dbClearLogs, dbUpsertUser, dbUpdateUser, dbSaveSetting, dbUpdateProvider, dbSetUserStatus, dbUpdateTokenMeta, dbUpdatePinnedModel, dbUpdateOutputType, dbSetContextBlock, dbClearContextBlock, dbSetContextGrace, deriveNameFromKey, slugify, ensureUniqueSlug, settings } from "../state";
import { prisma } from "../prisma";
import type { TokenProvider, UserStatus } from "../types";
import { clearInFlight, bumpGeneration } from "../tokens";
import { config }  from "../config";
import { triggerBroadcast } from "../broadcast";
import { getCustomProvider } from "../customProviders";
import { randomBytes } from "crypto";
import type { TokenEntry } from "../types";

function generateApiKey(): string {
  return "sk-cp-" + randomBytes(24).toString("base64url");
}

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

  if (pathname === "/admin/reset") {
    const target = form ? String(form.get("token") || "") : url.searchParams.get("token");
    const all    = form ? form.get("all") === "true" : url.searchParams.get("all") === "true";
    const now    = Date.now();
    if (all) {
      for (const [k, tk] of Object.entries(tokens)) {
        tk.used = 0; tk.windowStart = now; tk.last_reset = now;
        await dbResetToken(k, now);
        bumpGeneration(k);
      }
      clearInFlight();
    } else if (target && tokens[target]) {
      tokens[target].used = 0; tokens[target].windowStart = now; tokens[target].last_reset = now;
      await dbResetToken(target, now);
      bumpGeneration(target);
      clearInFlight(target);
    } else {
      return new Response("Token not found\n", { status: 404 });
    }
    return redirect();
  }

  if (pathname === "/admin/token/add" && req.method === "POST") {
    let newKey      = String(form?.get("token")   || "").trim();
    const newLimit  = String(form?.get("limit")   || "40000").trim();
    const userId    = String(form?.get("user_id") || "").trim();
    if (!newKey) {
      // Auto-generate unique key
      do { newKey = generateApiKey(); } while (tokens[newKey]);
    }
    if (tokens[newKey]) return new Response("Token already exists\n", { status: 409 });
    const parsed      = newLimit === "unlimited" ? Infinity : parseInt(newLimit);
    const customName  = String(form?.get("name") || "").trim();
    const displayName = customName || deriveNameFromKey(newKey);

    let uid = userId && users[userId] ? userId : "";
    if (!uid) {
      uid = ensureUniqueSlug(slugify(displayName), users);
      if (!users[uid]) {
        const userEntry = { id: uid, name: displayName, email: "", description: "", created_at: Date.now(), role: "USER" as const, status: "pending" as const };
        users[uid] = userEntry;
        await dbUpsertUser(userEntry);
      }
    }

    const label       = String(form?.get("label")       || "").trim();
    const description = String(form?.get("description") || "").trim();
    const entry: TokenEntry = {
      limit: parsed, window: config.windowMs,
      used: 0, windowStart: Date.now(), paused: false, dynamic: true, mode: "inherit", provider: "inherit",
      user_id: uid,
      label, description, pinned_model: "", output_type: "anthropic",
      last_reset: 0,
    };
    tokens[newKey] = entry;
    await dbInsertToken(newKey, entry);
    return redirect();
  }

  if (pathname === "/admin/token/meta" && req.method === "POST") {
    const target      = String(form?.get("token")       || "").trim();
    const label       = String(form?.get("label")       || "").trim();
    const description = String(form?.get("description") || "").trim();
    if (!target || !tokens[target]) return new Response("Token not found\n", { status: 404 });
    tokens[target].label       = label;
    tokens[target].description = description;
    await dbUpdateTokenMeta(target, label, description);
    return redirect();
  }

  if (pathname === "/admin/token/edit" && req.method === "POST") {
    const target   = String(form?.get("token") || "").trim();
    const newLimit = String(form?.get("limit")  || "").trim();
    if (!target || !tokens[target]) return new Response("Token not found\n", { status: 404 });
    const parsed = newLimit === "unlimited" ? Infinity : parseInt(newLimit);
    if (isNaN(parsed) && newLimit !== "unlimited") return new Response("Invalid limit\n", { status: 400 });
    tokens[target].limit = parsed;
    await dbUpdateToken(target, tokens[target]);
    return redirect();
  }

  if (pathname === "/admin/token/edit-all" && req.method === "POST") {
    const newLimit = String(form?.get("limit") || "").trim();
    const parsed   = newLimit === "unlimited" ? Infinity : parseInt(newLimit);
    if (isNaN(parsed) && newLimit !== "unlimited") return new Response("Invalid limit\n", { status: 400 });
    for (const [k, tk] of Object.entries(tokens)) {
      tk.limit = parsed;
      await dbUpdateToken(k, tk);
    }
    return redirect();
  }

  if (pathname === "/admin/token/pause" && req.method === "POST") {
    const target   = String(form?.get("token") || "").trim();
    const pauseAll = form?.get("all") === "true";
    if (pauseAll) {
      const all = Object.values(tokens).every(tk => tk.paused);
      for (const [k, tk] of Object.entries(tokens)) {
        tk.paused = !all;
        await dbUpdateToken(k, tk);
      }
    } else {
      if (!target || !tokens[target]) return new Response("Token not found\n", { status: 404 });
      tokens[target].paused = !tokens[target].paused;
      await dbUpdateToken(target, tokens[target]);
    }
    return redirect();
  }

  if (pathname === "/admin/token/delete" && req.method === "POST") {
    const target = String(form?.get("token") || "").trim();
    if (!target || !tokens[target]) return new Response("Token not found\n", { status: 404 });
    await dbSoftDelete(target);
    delete tokens[target];
    return redirect();
  }

  if (pathname === "/admin/token/rotate" && req.method === "POST") {
    const target    = String(form?.get("token")   || "").trim();
    const newKeyRaw = String(form?.get("new_key") || "").trim();
    if (!target || !tokens[target]) return new Response("Token not found\n", { status: 404 });
    const old    = tokens[target];
    const newKey = newKeyRaw || `${target}-${Math.random().toString(16).slice(2, 6)}`;
    if (tokens[newKey]) return new Response("New key already exists\n", { status: 409 });
    const entry: TokenEntry = { ...old, used: 0, windowStart: Date.now(), user_id: old.user_id };
    tokens[newKey] = entry;
    await dbInsertToken(newKey, entry);
    await dbSoftDelete(target);
    bumpGeneration(target);
    clearInFlight(target);
    delete tokens[target];
    return Response.json({ ok: true, newKey });
  }

  if (pathname === "/admin/token/output-type" && req.method === "POST") {
    const target      = String(form?.get("token") || "").trim();
    const output_type = String(form?.get("output_type") || "anthropic").trim();
    if (!target || !tokens[target]) return new Response("Token not found\n", { status: 404 });
    if (output_type !== "anthropic" && output_type !== "openai")
      return new Response("Invalid output_type\n", { status: 400 });
    await dbUpdateOutputType(target, output_type);
    return redirect();
  }

  if (pathname === "/admin/token/pin-model" && req.method === "POST") {
    const target = String(form?.get("token") || "").trim();
    const model  = String(form?.get("model") || "").trim();
    if (!target || !tokens[target]) return new Response("Token not found\n", { status: 404 });
    tokens[target].pinned_model = model;
    await dbUpdatePinnedModel(target, model);
    return redirect();
  }

  if (pathname === "/admin/token/pin-all" && req.method === "POST") {
    const model         = String(form?.get("model")          || "").trim();
    const userId        = String(form?.get("user_id")        || "").trim();
    const providerScope = String(form?.get("provider_scope") || "").trim();
    // providerScope semantics — uses EFFECTIVE routing (matches what proxy.ts does at runtime).
    //  - ""           = all tokens (no scope filter)
    //  - "anthropic"  = tokens that effectively route to Claude
    //  - "deepseek"   = tokens that effectively route to DeepSeek
    //  - "openrouter" = tokens that effectively route to OpenRouter
    //  - custom slug  = tokens that effectively route to that custom provider
    const globalOverride = settings["provider_override"] || "";
    const deepseekConfigured   = !!(settings["deepseek_api_key"]   || config.deepseekApiKey);
    const openrouterConfigured = !!(settings["openrouter_api_key"] || config.openrouterApiKey);
    const isConfigured = (id: string): boolean => {
      if (id === "anthropic" || id === "" || id === "inherit") return true;
      if (id === "deepseek")   return deepseekConfigured;
      if (id === "openrouter") return openrouterConfigured;
      const cp = getCustomProvider(id);
      return !!(cp && cp.api_key);
    };
    const effectiveProviderOf = (tokenProvider: string): string => {
      if (tokenProvider && tokenProvider !== "inherit") {
        return isConfigured(tokenProvider) ? tokenProvider : "anthropic";
      }
      if (globalOverride) {
        return isConfigured(globalOverride) ? globalOverride : "anthropic";
      }
      return "anthropic";
    };
    const inScope = (tokenProvider: string) => {
      if (!providerScope) return true;
      return effectiveProviderOf(tokenProvider) === providerScope;
    };
    let pinnedCount = 0;
    for (const [k, tk] of Object.entries(tokens)) {
      if (userId && tk.user_id !== userId) continue;
      if (!inScope(tk.provider || "inherit")) continue;
      tk.pinned_model = model;
      await dbUpdatePinnedModel(k, model);
      pinnedCount++;
    }
    triggerBroadcast();
    return Response.json({ ok: true, count: pinnedCount });
  }

  if (pathname === "/admin/token/provider" && req.method === "POST") {
    const target   = String(form?.get("token")    || "").trim();
    const provider = String(form?.get("provider") || "inherit").trim() as TokenProvider;
    if (!target || !tokens[target]) return new Response("Token not found\n", { status: 404 });
    const valid: TokenProvider[] = ["inherit", "anthropic", "deepseek", "openrouter"];
    if (!valid.includes(provider)) return new Response("Invalid provider\n", { status: 400 });
    if (provider === "deepseek" && !settings["deepseek_api_key"]) {
      return Response.json({ ok: false, error: "DeepSeek API key not configured." }, { status: 400 });
    }
    if (provider === "openrouter" && !settings["openrouter_api_key"]) {
      return Response.json({ ok: false, error: "OpenRouter API key not configured." }, { status: 400 });
    }
    tokens[target].provider = provider;
    await dbUpdateProvider(target, provider);
    return redirect();
  }

  if (pathname === "/admin/user/set-email" && req.method === "POST") {
    const uid   = String(form?.get("user_id") || "").trim();
    const email = String(form?.get("email")   || "").trim();
    if (!uid || !users[uid]) return new Response("User not found\n", { status: 404 });
    if (!email || !email.includes("@")) return new Response("Valid email required\n", { status: 400 });
    for (const [id, u] of Object.entries(users)) {
      if (u.email === email && id !== uid) return new Response("Email already assigned\n", { status: 409 });
    }
    users[uid].email = email;
    await prisma.users.update({ where: { id: uid }, data: { email } });
    return redirect();
  }

  if (pathname === "/admin/user/edit" && req.method === "POST") {
    const uid     = String(form?.get("user_id")     || "").trim();
    const newName = String(form?.get("name")        || "").trim();
    const newDesc = String(form?.get("description") || "");
    if (!uid || !users[uid]) return new Response("User not found\n", { status: 404 });
    if (!newName)             return new Response("Name required\n",  { status: 400 });
    users[uid].name        = newName;
    users[uid].description = newDesc;
    await dbUpdateUser(uid, newName, newDesc);
    return redirect();
  }

  if (pathname === "/admin/settings/deepseek" && req.method === "POST") {
    const apiKey  = String(form?.get("api_key")  || "").trim();
    const baseUrl = String(form?.get("base_url") || "").trim();
    const model   = String(form?.get("model")    || "").trim();
    if (apiKey)  await dbSaveSetting("deepseek_api_key", apiKey);
    if (baseUrl) await dbSaveSetting("deepseek_base_url", baseUrl);
    if (model)   await dbSaveSetting("deepseek_model", model);
    return redirect();
  }

  if (pathname === "/admin/settings/openrouter" && req.method === "POST") {
    const apiKey  = String(form?.get("api_key")  || "").trim();
    const baseUrl = String(form?.get("base_url") || "").trim();
    const model   = String(form?.get("model")    || "").trim();
    if (apiKey)  await dbSaveSetting("openrouter_api_key", apiKey);
    if (baseUrl) await dbSaveSetting("openrouter_base_url", baseUrl);
    if (model)   await dbSaveSetting("openrouter_model", model);
    return redirect();
  }

  if (pathname === "/admin/settings/provider-override" && req.method === "POST") {
    const override = String(form?.get("override") || "").trim();
    // Accept: "" (auto), "anthropic", "deepseek", "openrouter", or custom provider slug
    await dbSaveSetting("provider_override", override);
    return redirect();
  }

  if (pathname === "/admin/settings/simulate-anthropic-disabled" && req.method === "POST") {
    const enabled = String(form?.get("enabled") || "").trim() === "true";
    await dbSaveSetting("simulate_anthropic_disabled", enabled ? "true" : "false");
    triggerBroadcast();
    return Response.json({ ok: true, enabled });
  }

  if (pathname === "/admin/settings/reset-mode" && req.method === "POST") {
    const mode = String(form?.get("mode") || "").trim();
    if (!["manual", "auto", "daily"].includes(mode)) {
      return Response.json({ ok: false, error: "mode must be manual | auto | daily" }, { status: 400 });
    }
    await dbSaveSetting("reset_mode", mode);
    triggerBroadcast();
    return Response.json({ ok: true, mode });
  }

  if (pathname === "/admin/users/purge-orphans" && req.method === "POST") {
    const tokenUserIds = new Set(Object.values(tokens).map(tk => tk.user_id).filter(Boolean));
    const orphans = Object.values(users).filter(u => !tokenUserIds.has(u.id));
    let deleted = 0;
    for (const u of orphans) {
      await prisma.users.delete({ where: { id: u.id } });
      delete users[u.id];
      deleted++;
    }
    triggerBroadcast();
    return Response.json({ ok: true, deleted });
  }

  if (pathname === "/admin/user/set-status" && req.method === "POST") {
    const uid    = String(form?.get("user_id") || "").trim();
    const status = String(form?.get("status")  || "").trim() as UserStatus;
    if (!uid || !users[uid]) return new Response("User not found\n", { status: 404 });
    const valid: UserStatus[] = ["pending", "approved", "blocked"];
    if (!valid.includes(status)) return new Response("Invalid status\n", { status: 400 });
    await dbSetUserStatus(uid, status);
    return redirect();
  }

  if (pathname === "/admin/settings/demo" && req.method === "POST") {
    const demo = String(form?.get("demo") || "false").trim();
    await dbSaveSetting("demo_mode", demo === "true" ? "true" : "false");
    return redirect();
  }

  if (pathname === "/admin/settings/context-block-enabled" && req.method === "POST") {
    const val = String(form?.get("enabled") || "true").trim();
    await dbSaveSetting("context_block_enabled", val === "false" ? "false" : "true");
    return redirect();
  }

  if (pathname === "/admin/settings/provider-model" && req.method === "POST") {
    const provider = String(form?.get("provider") || "").trim();
    const model    = String(form?.get("model")    || "").trim();
    if (provider !== "deepseek" && provider !== "openrouter") {
      return Response.json({ ok: false, error: "Provider must be 'deepseek' or 'openrouter'" }, { status: 400 });
    }
    await dbSaveSetting(`${provider}_model`, model);
    return redirect();
  }

  if (pathname === "/admin/settings/poll-interval" && req.method === "POST") {
    const seconds = parseInt(String(form?.get("seconds") || "").trim());
    if (!Number.isFinite(seconds) || seconds < 10 || seconds > 300) {
      return Response.json({ ok: false, error: "Seconds must be 10–300 (10s to 5 min)" }, { status: 400 });
    }
    await dbSaveSetting("poll_interval_ms", String(seconds * 1000));
    return redirect();
  }

  if (pathname === "/admin/user/context-grace" && req.method === "POST") {
    const userId  = form ? String(form.get("user_id") || "").trim() : "";
    const minutes = parseInt(form ? String(form.get("minutes") || "30") : "30") || 30;
    if (!userId || !users[userId]) return new Response("User not found\n", { status: 404 });
    await dbSetContextGrace(userId, minutes);
    console.log(`[admin] context_grace set for user=${userId} minutes=${minutes}`);
    return redirect();
  }

  if (pathname === "/admin/user/block-context" && req.method === "POST") {
    const userId = form ? String(form.get("user_id") || "").trim() : "";
    const reason = form ? String(form.get("reason") || "").trim() : "";
    if (!userId || !users[userId]) return new Response("User not found\n", { status: 404 });
    await dbSetContextBlock(userId, reason || "Diblokir manual oleh admin.");
    console.log(`[admin] context_block set manually for user=${userId}`);
    return redirect();
  }

  if (pathname === "/admin/user/unblock-context" && req.method === "POST") {
    const userId = form ? String(form.get("user_id") || "").trim() : "";
    if (!userId || !users[userId]) return new Response("User not found\n", { status: 404 });
    await dbClearContextBlock(userId);
    console.log(`[admin] context_block cleared for user=${userId}`);
    return redirect();
  }

  if (pathname === "/admin/logs/clear" && req.method === "POST") {
    const user = form ? String(form.get("user") || "").trim() : "";
    await dbClearLogs(user || undefined);
    return Response.json({ ok: true });
  }

  if (pathname === "/admin/usage/clear" && req.method === "POST") {
    await prisma.daily_usage.deleteMany({});
    triggerBroadcast();
    return Response.json({ ok: true });
  }

  return new Response("Not found\n", { status: 404 });
}
