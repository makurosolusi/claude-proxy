import { prisma } from "../prisma";
import { users, tokens, dbUpsertUser, dbUpdateUser, dbDeleteUser, dbLinkTokenToUser, deriveNameFromKey, slugify, ensureUniqueSlug } from "../state";
import { config } from "../config";
import { triggerBroadcast } from "../broadcast";
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
    const list = Object.values(users).map(u => {
      const userTokens = Object.entries(tokens)
        .filter(([, tk]) => tk.user_id === u.id)
        .map(([key, tk]) => ({
          key: key.slice(-8), fullKey: key,
          name: tk.name, used: tk.used, limit: tk.limit === Infinity ? null : tk.limit,
          paused: tk.paused, provider: tk.provider,
        }));
      return { ...u, created_at: Number(u.created_at), tokens: userTokens };
    }).sort((a, b) => a.name.localeCompare(b.name));
    return Response.json({ users: list });
  }

  // POST /api/admin/users — create user
  if (req.method === "POST" && pathname === "/api/admin/users") {
    const body = await req.json().catch(() => ({})) as any;
    const name = String(body.name || "").trim();
    if (!name) return Response.json({ error: "Name required" }, { status: 400 });
    const id = ensureUniqueSlug(slugify(name), users);
    const entry: UserEntry = { id, name, email: body.email || "", description: body.description || "", created_at: Date.now(), role: "USER" };
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
    // Update display name on active tokens for this user
    for (const [key, tk] of Object.entries(tokens)) {
      if (tk.user_id === id) {
        tk.name = newName;
        await prisma.tokens.update({ where: { key }, data: { name: newName } });
      }
    }
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
