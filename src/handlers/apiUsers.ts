import { prisma } from "../prisma";
import { users, tokens, dailyUsage, allTimePerUser, dbUpsertUser, dbUpdateUser, dbDeleteUser, dbLinkTokenToUser, deriveNameFromKey, slugify, ensureUniqueSlug } from "../state";
import { config } from "../config";
import { triggerBroadcast } from "../broadcast";
import { todayKey } from "../tokens";
import type { DailyUsage } from "../types";
import type { TokenEntry, UserEntry } from "../types";

export async function handleApiUsers(
  req: Request, url: URL,
  _users: typeof users, _tokens: typeof tokens,
  _dailyUsage: DailyUsage, _allTimePerUser: Record<string, number>
): Promise<Response> {
  const pathname = url.pathname;

  // GET /api/admin/users
  if (req.method === "GET" && pathname === "/api/admin/users") {
    const today = todayKey();
    const todayUsage = dailyUsage[today] ?? {};
    const list = Object.values(users).map(u => {
      const userTokens = Object.entries(tokens)
        .filter(([, tk]) => tk.user_id === u.id)
        .map(([key, tk]) => {
          const limit   = tk.limit === Infinity ? null : tk.limit;
          const pct     = limit && limit > 0 ? Math.round((tk.used / limit) * 100) : 0;
          const todayV  = todayUsage[key] ?? 0;
          const alltime = allTimePerUser[u.id] ?? allTimePerUser[key] ?? 0;
          return {
            key,
            used: tk.used, limit,
            paused: tk.paused, provider: tk.provider,
            dynamic: tk.dynamic,
            pct, today: todayV, alltime,
            label: tk.label || "", description: tk.description || "",
            pinned_model: tk.pinned_model || "",
            allowed_models: tk.allowed_models || [],
            output_type: tk.output_type || "anthropic",
            last_reset: tk.last_reset || 0,
          };
        });
      return { ...u, created_at: Number(u.created_at), status: u.status || "pending", tokens: userTokens };
    }).sort((a, b) => a.name.localeCompare(b.name));
    return Response.json({ users: list });
  }

  // POST /api/admin/users — create user
  if (req.method === "POST" && pathname === "/api/admin/users") {
    const body = await req.json().catch(() => ({})) as any;
    const name = String(body.name || "").trim();
    if (!name) return Response.json({ error: "Name required" }, { status: 400 });
    const id = ensureUniqueSlug(slugify(name), users);
    const entry: UserEntry = { id, name, email: body.email || "", description: body.description || "", created_at: Date.now(), role: "USER", status: "pending" };
    users[id] = entry;
    await dbUpsertUser(entry);
    triggerBroadcast();
    return Response.json({ ok: true, id });
  }

  // PATCH /api/admin/users/:id — edit user
  if (req.method === "PATCH" && pathname.startsWith("/api/admin/users/")) {
    const id = decodeURIComponent(pathname.slice("/api/admin/users/".length));
    if (!users[id]) return Response.json({ error: "User not found" }, { status: 404 });
    const body = await req.json().catch(() => ({})) as any;
    const newName = String(body.name || users[id].name).trim();
    const newDesc = String(body.description ?? users[id].description);
    if (!newName) return Response.json({ error: "Name required" }, { status: 400 });
    users[id].name = newName;
    users[id].description = newDesc;
    await dbUpdateUser(id, newName, newDesc);
    triggerBroadcast();
    return Response.json({ ok: true });
  }

  // DELETE /api/admin/users/:id
  if (req.method === "DELETE" && pathname.startsWith("/api/admin/users/")) {
    const id = decodeURIComponent(pathname.slice("/api/admin/users/".length));
    if (!users[id]) return Response.json({ error: "User not found" }, { status: 404 });
    for (const [key, tk] of Object.entries(tokens)) {
      if (tk.user_id === id) {
        await prisma.tokens.update({ where: { key }, data: { deleted: true } });
        delete tokens[key];
      }
    }
    await dbDeleteUser(id);
    delete users[id];
    triggerBroadcast();
    return Response.json({ ok: true });
  }

  return Response.json({ error: "Not found" }, { status: 404 });
}
