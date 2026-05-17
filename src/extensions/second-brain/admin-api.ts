import { prisma } from "../../prisma";
import { isEnabled, getConfig, updateExtensionConfig } from "../registry";
import { embedText } from "./embedding";
import { defaultConfig, type SecondBrainConfig } from "./config";
import { triggerBroadcast } from "../../broadcast";

function notEnabled(): Response {
  return Response.json({ ok: false, error: "Second Brain extension is not enabled" }, { status: 409 });
}

function effectiveConfig(): SecondBrainConfig {
  return { ...defaultConfig, ...(getConfig("second-brain") as Partial<SecondBrainConfig>) };
}

export async function handleSecondBrainAdmin(req: Request, url: URL): Promise<Response> {
  if (!isEnabled("second-brain")) return notEnabled();
  const path = url.pathname;

  if (req.method === "GET" && path === "/api/admin/second-brain/overview")     return handleOverview();
  if (req.method === "GET" && path === "/api/admin/second-brain/strategies")   return handleListStrategies(url);
  if (req.method === "POST" && path.startsWith("/api/admin/second-brain/strategies/") && path.endsWith("/delete")) {
    const id = path.split("/").slice(-2, -1)[0]!;
    return handleDeleteStrategy(id);
  }
  if (req.method === "GET" && path === "/api/admin/second-brain/settings")     return Response.json({ config: effectiveConfig() });
  if (req.method === "POST" && path === "/api/admin/second-brain/settings") {
    const patch = await req.json().catch(() => ({})) as any;
    const res = await updateExtensionConfig("second-brain", patch);
    if (!res.ok) return Response.json(res, { status: 400 });
    triggerBroadcast();
    return Response.json({ ok: true, config: { ...defaultConfig, ...(res.config as Partial<SecondBrainConfig>) } });
  }

  return Response.json({ error: "Not found" }, { status: 404 });
}

async function handleOverview(): Promise<Response> {
  const since = BigInt(Date.now() - 7 * 86400_000);
  const [counts, recent, topStrategies, totalStrategies] = await Promise.all([
    prisma.$queryRawUnsafe<any[]>(
      `SELECT event_type, COUNT(*)::int AS c
         FROM sb_extension_logs WHERE ts > $1
         GROUP BY event_type ORDER BY c DESC`,
      since,
    ),
    prisma.$queryRawUnsafe<any[]>(
      `SELECT ts, event_type, detail, user_id
         FROM sb_extension_logs WHERE ts > $1
         ORDER BY ts DESC LIMIT 30`,
      since,
    ),
    prisma.$queryRawUnsafe<any[]>(
      `SELECT id, title, when_to_use, scope, user_id, use_count, success_count, fail_count
         FROM sb_strategies
         ORDER BY use_count DESC LIMIT 10`,
    ),
    prisma.$queryRawUnsafe<any[]>(`SELECT COUNT(*)::int AS c FROM sb_strategies`),
  ]);

  const byType = Object.fromEntries(counts.map((r: any) => [r.event_type, r.c]));

  return Response.json({
    strategies: {
      total:         totalStrategies[0]?.c || 0,
      mined_7d:      byType.mine_completed || 0,
      skipped_7d:    byType.mine_skipped || 0,
      failed_7d:     byType.mine_failed || 0,
      enqueued_7d:   byType.mine_enqueued || 0,
      injected_7d:   byType.strategy_injected || 0,
      used_success_7d: byType.strategy_used_success || 0,
      used_fail_7d:    byType.strategy_used_fail || 0,
      top:           topStrategies.map((s: any) => ({ ...s, use_count: Number(s.use_count), success_count: Number(s.success_count), fail_count: Number(s.fail_count) })),
    },
    recent_events: recent.map((r: any) => ({
      ts:         Number(r.ts),
      event_type: r.event_type,
      user_id:    r.user_id,
      detail:     (() => { try { return JSON.parse(r.detail); } catch { return r.detail; } })(),
    })),
    event_counts_7d: byType,
  });
}

async function handleListStrategies(url: URL): Promise<Response> {
  const q     = (url.searchParams.get("q") || "").trim();
  const limit = Math.min(100, parseInt(url.searchParams.get("limit") || "50"));
  let rows: any[];
  if (q) {
    const vec = await embedText(q);
    const vecLit = "[" + vec.join(",") + "]";
    rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, title, when_to_use, content, pitfalls, scope, user_id, project, tags,
              use_count, success_count, fail_count, created_at, updated_at,
              1 - (embedding <=> $1::vector) AS similarity
         FROM sb_strategies
         ORDER BY embedding <=> $1::vector
         LIMIT $2`,
      vecLit, limit,
    );
  } else {
    rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, title, when_to_use, content, pitfalls, scope, user_id, project, tags,
              use_count, success_count, fail_count, created_at, updated_at
         FROM sb_strategies
         ORDER BY updated_at DESC LIMIT $1`,
      limit,
    );
  }
  return Response.json({
    strategies: rows.map((r: any) => ({
      id: r.id, title: r.title, when_to_use: r.when_to_use,
      content: safeJson(r.content), pitfalls: safeJson(r.pitfalls), tags: safeJson(r.tags),
      scope: r.scope, user_id: r.user_id, project: r.project,
      use_count: Number(r.use_count), success_count: Number(r.success_count), fail_count: Number(r.fail_count),
      created_at: Number(r.created_at), updated_at: Number(r.updated_at),
      similarity: r.similarity != null ? Number(r.similarity) : undefined,
    })),
  });
}

async function handleDeleteStrategy(id: string): Promise<Response> {
  await prisma.$executeRawUnsafe(`DELETE FROM sb_strategies WHERE id = $1`, id);
  triggerBroadcast();
  return Response.json({ ok: true });
}

function safeJson(s: string): any {
  try { return JSON.parse(s); } catch { return s; }
}
