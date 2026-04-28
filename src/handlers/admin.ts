import { tokens, dbInsertToken, dbUpdateToken, dbSoftDelete, dbResetToken, dbClearLogs, dbUpdateTokenMode } from "../state";
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
  return new Response(null, { status: 303, headers: { Location: "/admin" } });
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
      }
    } else if (target && tokens[target]) {
      tokens[target].used = 0; tokens[target].windowStart = now;
      dbResetToken(target, now);
    } else {
      return new Response("Token not found\n", { status: 404 });
    }
    return redirect();
  }

  // Add token
  if (pathname === "/admin/token/add" && req.method === "POST") {
    const newKey   = String(form?.get("token") || "").trim();
    const newLimit = String(form?.get("limit")  || "40000").trim();
    if (!newKey)        return new Response("Key required\n",          { status: 400 });
    if (tokens[newKey]) return new Response("Token already exists\n", { status: 409 });
    const parsed = newLimit === "unlimited" ? Infinity : parseInt(newLimit);
    const entry: TokenEntry = {
      limit: parsed, window: config.windowMs,
      used: 0, windowStart: Date.now(), paused: false, dynamic: true,
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

  // Set per-token mode override (for canary rollout)
  if (pathname === "/admin/token/mode" && req.method === "POST") {
    const target = String(form?.get("token") || "").trim();
    const mode   = String(form?.get("mode")  || "inherit").trim() as "inherit" | "direct" | "cliproxy";
    if (!target || !tokens[target]) return new Response("Token not found\n", { status: 404 });
    if (!["inherit", "direct", "cliproxy"].includes(mode)) return new Response("Invalid mode\n", { status: 400 });
    tokens[target].mode = mode;
    dbUpdateTokenMode(target, mode);
    return redirect();
  }

  // Clear logs
  if (pathname === "/admin/logs/clear" && req.method === "POST") {
    const user = form ? String(form.get("user") || "").trim() : "";
    dbClearLogs(user || undefined);
    return Response.json({ ok: true });
  }

  return new Response("Not found\n", { status: 404 });
}
