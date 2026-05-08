import { db, dbUpsertUser, dbUpdateUser, dbDeleteUser, dbLinkTokenToUser, deriveNameFromKey, slugify, ensureUniqueSlug } from "../state";
import { triggerBroadcast } from "../broadcast";
import type { UserEntry, TokenEntry, DailyUsage } from "../types";
import { todayKey } from "../tokens";

export async function handleApiUsers(
  req: Request,
  url: URL,
  users: Record<string, UserEntry>,
  tokens: Record<string, TokenEntry>,
  dailyUsage: DailyUsage,
  allTimePerUser: Record<string, number>,
): Promise<Response> {
  const pathname = url.pathname;

  // GET /api/admin/users — list all users with their tokens
  if (req.method === "GET" && pathname === "/api/admin/users") {
    const today = todayKey();
    const result = Object.values(users).map(u => {
      const userTokens = Object.entries(tokens)
        .filter(([, tk]) => tk.user_id === u.id)
        .map(([key, tk]) => ({
          key,
          name:      tk.name,
          limit:     tk.limit === Infinity ? null : tk.limit,
          used:      tk.used,
          paused:    tk.paused,
          dynamic:   tk.dynamic,
          today:     (dailyUsage[today] || {})[key] || 0,
          alltime:   allTimePerUser[u.id] || 0,
          pct:       tk.limit === Infinity ? 0 : Math.round((tk.used / tk.limit) * 100),
          provider:  tk.provider || "inherit",
        }));
      return { ...u, email: u.email || "", tokens: userTokens };
    }).sort((a, b) => a.name.localeCompare(b.name));
    return Response.json(result);
  }

  // POST /api/admin/users — create user (no token)
  if (req.method === "POST" && pathname === "/api/admin/users") {
    const body = await req.json() as any;
    const name = String(body.name || "").trim();
    if (!name) return Response.json({ error: "Name required" }, { status: 400 });
    const base = slugify(name);
    const id   = ensureUniqueSlug(base, users);
    const entry: UserEntry = { id, name, email: "", description: String(body.description || ""), created_at: Date.now(), role: "USER" };
    users[id] = entry;
    dbUpsertUser(entry);
    triggerBroadcast();
    return Response.json({ ok: true, user: entry });
  }

  // PATCH /api/admin/users/:id — edit user name / description
  if (req.method === "PATCH" && pathname.startsWith("/api/admin/users/")) {
    const id = decodeURIComponent(pathname.slice("/api/admin/users/".length));
    if (!users[id]) return Response.json({ error: "User not found" }, { status: 404 });
    const body = await req.json() as any;
    const newName = body.name !== undefined ? String(body.name).trim() : users[id].name;
    const newDesc = body.description !== undefined ? String(body.description) : users[id].description;
    if (!newName) return Response.json({ error: "Name required" }, { status: 400 });
    users[id].name = newName;
    users[id].description = newDesc;
    dbUpdateUser(id, newName, newDesc);
    // Update display name on all active tokens for this user
    for (const [key, tk] of Object.entries(tokens)) {
      if (tk.user_id === id) {
        tk.name = newName;
        db.query("UPDATE tokens SET name=? WHERE key=?").run(newName, key);
      }
    }
    triggerBroadcast();
    return Response.json({ ok: true });
  }

  // DELETE /api/admin/users/:id — delete user + soft-delete all their tokens
  if (req.method === "DELETE" && pathname.startsWith("/api/admin/users/")) {
    const id = decodeURIComponent(pathname.slice("/api/admin/users/".length));
    if (!users[id]) return Response.json({ error: "User not found" }, { status: 404 });
    for (const [key, tk] of Object.entries(tokens)) {
      if (tk.user_id === id) {
        db.query("UPDATE tokens SET deleted=1 WHERE key=?").run(key);
        delete tokens[key];
      }
    }
    dbDeleteUser(id);
    delete users[id];
    triggerBroadcast();
    return Response.json({ ok: true });
  }

  return Response.json({ error: "Not found" }, { status: 404 });
}
