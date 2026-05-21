import { config } from "../config";
import { prisma } from "../prisma";

function checkMcpSecret(req: Request): boolean {
  if (!config.mcpSecret) return false;
  const token = req.headers.get("x-mcp-secret") || req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return token === config.mcpSecret;
}

// GET /api/debug/notifications — inspect admin broadcast state without UI access.
// Returns active notifications + dismissal counts so we can tell who's seen what.
export async function handleDebugNotifications(req: Request, url: URL): Promise<Response> {
  if (!checkMcpSecret(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const limit = Math.max(1, Math.min(parseInt(url.searchParams.get("limit") || "50") || 50, 200));
  const includeDeleted = url.searchParams.get("include_deleted") === "true";

  const rows = await prisma.admin_notifications.findMany({
    where: includeDeleted ? {} : { deleted: false },
    orderBy: { created_at: "desc" },
    take: limit,
  });

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
    total: rows.length,
    notifications: rows.map(r => {
      let targets: string[] = [];
      if (r.target_ids) { try { const p = JSON.parse(r.target_ids); if (Array.isArray(p)) targets = p.map(String); } catch {} }
      return {
        id:              r.id,
        message:         r.message,
        message_preview: r.message.slice(0, 80),
        created_at:      Number(r.created_at),
        age_sec:         Math.round((Date.now() - Number(r.created_at)) / 1000),
        created_by:      r.created_by,
        target_type:     r.target_type,
        target_count:    r.target_type === "specific" ? targets.length : null,
        target_ids:      r.target_type === "specific" ? targets : [],
        deleted:         r.deleted,
        dismissed_count: countMap.get(r.id) ?? 0,
      };
    }),
  });
}
