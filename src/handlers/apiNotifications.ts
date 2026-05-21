import { prisma } from "../prisma";
import { users } from "../state";
import { broadcastNotifChanged } from "../broadcast";

const MAX_MESSAGE_LEN = 4000;

type Notification = {
  id: string;
  message: string;
  created_at: number;
  created_by: string;
  target_type: "all" | "specific";
  target_ids: string[];
};

function rowToNotification(row: any): Notification {
  let ids: string[] = [];
  if (row.target_ids) {
    try { const parsed = JSON.parse(row.target_ids); if (Array.isArray(parsed)) ids = parsed.map(String); }
    catch {}
  }
  return {
    id:          row.id,
    message:     row.message,
    created_at:  Number(row.created_at),
    created_by:  row.created_by || "",
    target_type: row.target_type === "specific" ? "specific" : "all",
    target_ids:  ids,
  };
}

// ── Admin: POST /api/admin/notifications ─────────────────────────────────────
export async function handleAdminCreateNotification(req: Request, adminEmail: string): Promise<Response> {
  const body = await req.json().catch(() => ({})) as any;
  const message = String(body.message ?? "").trim();
  if (!message)               return Response.json({ error: "Message required" }, { status: 400 });
  if (message.length > MAX_MESSAGE_LEN) return Response.json({ error: `Message too long (max ${MAX_MESSAGE_LEN} chars)` }, { status: 400 });

  const rawTarget = String(body.target_type || "all");
  const targetType: "all" | "specific" = rawTarget === "specific" ? "specific" : "all";

  let targetIds: string[] = [];
  if (targetType === "specific") {
    const raw = Array.isArray(body.target_ids) ? body.target_ids : [];
    targetIds = raw.map((x: unknown) => String(x)).filter((id: string) => !!users[id]);
    if (targetIds.length === 0) {
      return Response.json({ error: "target_ids must contain at least one valid user id" }, { status: 400 });
    }
  }

  const id = crypto.randomUUID();
  const now = Date.now();
  await prisma.admin_notifications.create({
    data: {
      id, message, created_at: BigInt(now), created_by: adminEmail || "",
      target_type: targetType,
      target_ids: targetType === "specific" ? JSON.stringify(targetIds) : "",
    },
  });

  // Notify all connected clients that the notification list changed; each
  // client refetches its own pending list (server-side filters by user).
  triggerNotificationsChanged();

  return Response.json({
    ok: true,
    notification: {
      id, message, created_at: now, created_by: adminEmail || "",
      target_type: targetType, target_ids: targetIds,
    },
  });
}

// ── Admin: GET /api/admin/notifications ──────────────────────────────────────
export async function handleAdminListNotifications(): Promise<Response> {
  const rows = await prisma.admin_notifications.findMany({
    where: { deleted: false },
    orderBy: { created_at: "desc" },
    take: 100,
  });
  // Per-notification dismissal counts so admin can see uptake at a glance.
  const ids = rows.map(r => r.id);
  const counts = ids.length
    ? await prisma.notification_dismissals.groupBy({
        by: ["notification_id"],
        where: { notification_id: { in: ids } },
        _count: { user_id: true },
      })
    : [];
  const countMap = new Map(counts.map(c => [c.notification_id, c._count.user_id]));
  return Response.json({
    notifications: rows.map(r => ({
      ...rowToNotification(r),
      dismissed_count: countMap.get(r.id) ?? 0,
    })),
  });
}

// ── Admin: DELETE /api/admin/notifications/:id ───────────────────────────────
export async function handleAdminDeleteNotification(id: string): Promise<Response> {
  if (!id) return Response.json({ error: "Missing id" }, { status: 400 });
  const row = await prisma.admin_notifications.findUnique({ where: { id } });
  if (!row || row.deleted) return Response.json({ error: "Not found" }, { status: 404 });
  await prisma.admin_notifications.update({ where: { id }, data: { deleted: true } });
  // Don't bother deleting dismissal rows — they're tiny and the soft-delete
  // already hides the notification everywhere. Cleanup is a separate concern.
  triggerNotificationsChanged();
  return Response.json({ ok: true });
}

// ── User: GET /api/notifications/pending ─────────────────────────────────────
export async function handleUserPendingNotifications(userId: string): Promise<Response> {
  const list = await loadPendingForUser(userId);
  return Response.json({ notifications: list });
}

// ── User: POST /api/notifications/:id/dismiss ────────────────────────────────
export async function handleUserDismissNotification(userId: string, id: string): Promise<Response> {
  if (!id) return Response.json({ error: "Missing id" }, { status: 400 });
  const row = await prisma.admin_notifications.findUnique({ where: { id } });
  if (!row || row.deleted) return Response.json({ error: "Not found" }, { status: 404 });

  // Verify the user is actually targeted — silently 404 otherwise so we don't
  // let an unauthorized user mark someone else's notification "read".
  if (row.target_type === "specific") {
    try {
      const ids = JSON.parse(row.target_ids || "[]");
      if (!Array.isArray(ids) || !ids.includes(userId)) {
        return Response.json({ error: "Not found" }, { status: 404 });
      }
    } catch { return Response.json({ error: "Not found" }, { status: 404 }); }
  }

  await prisma.notification_dismissals.upsert({
    where:  { notification_id_user_id: { notification_id: id, user_id: userId } },
    create: { notification_id: id, user_id: userId, dismissed_at: BigInt(Date.now()) },
    update: { dismissed_at: BigInt(Date.now()) },
  });
  return Response.json({ ok: true });
}

// ── Internal helpers ─────────────────────────────────────────────────────────
async function loadPendingForUser(userId: string): Promise<Notification[]> {
  const dismissals = await prisma.notification_dismissals.findMany({
    where: { user_id: userId },
    select: { notification_id: true },
  });
  const dismissedIds = new Set(dismissals.map(d => d.notification_id));

  const rows = await prisma.admin_notifications.findMany({
    where: { deleted: false },
    orderBy: { created_at: "asc" },
    take: 50,
  });

  const out: Notification[] = [];
  for (const row of rows) {
    if (dismissedIds.has(row.id)) continue;
    const n = rowToNotification(row);
    if (n.target_type === "specific" && !n.target_ids.includes(userId)) continue;
    out.push(n);
  }
  return out;
}

function triggerNotificationsChanged() {
  broadcastNotifChanged();
}
