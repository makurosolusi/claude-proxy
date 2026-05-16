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
  if (req.method === "GET" && path === "/api/admin/second-brain/cache")        return handleListCache(url);
  if (req.method === "POST" && path === "/api/admin/second-brain/cache/clear") return handleClearCache(req);
  if (req.method === "GET" && path === "/api/admin/second-brain/settings")     return Response.json({ config: effectiveConfig() });
  if (req.method === "POST" && path === "/api/admin/second-brain/settings") {
    const patch = await req.json().catch(() => ({})) as any;
    const res = await updateExtensionConfig("second-brain", patch);
    if (!res.ok) return Response.json(res, { status: 400 });
    triggerBroadcast();
    return Response.json({ ok: true, config: { ...defaultConfig, ...(res.config as Partial<SecondBrainConfig>) } });
  }
  if (req.method === "POST" && path === "/api/admin/second-brain/backfill")    return handleBackfill(req);

  return Response.json({ error: "Not found" }, { status: 404 });
}

async function handleOverview(): Promise<Response> {
  const since = BigInt(Date.now() - 7 * 86400_000);
  const [counts, recent, topStrategies, cacheCount, totalStrategies] = await Promise.all([
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
    prisma.$queryRawUnsafe<any[]>(`SELECT COUNT(*)::int AS c, COALESCE(SUM(hit_count), 0)::int AS hits FROM sb_prompt_cache`),
    prisma.$queryRawUnsafe<any[]>(`SELECT COUNT(*)::int AS c FROM sb_strategies`),
  ]);

  const byType = Object.fromEntries(counts.map((r: any) => [r.event_type, r.c]));
  const cacheHits = (byType.cache_hit_exact || 0) + (byType.cache_hit_semantic || 0);
  const cacheMisses = byType.cache_miss || 0;
  const hitRate = cacheHits + cacheMisses > 0 ? (cacheHits / (cacheHits + cacheMisses)) : 0;

  return Response.json({
    cache: {
      hits_7d:      cacheHits,
      hit_exact_7d: byType.cache_hit_exact || 0,
      hit_semantic_7d: byType.cache_hit_semantic || 0,
      miss_7d:      cacheMisses,
      hit_rate_7d:  hitRate,
      entries:      cacheCount[0]?.c || 0,
      total_hits:   cacheCount[0]?.hits || 0,
    },
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

async function handleListCache(url: URL): Promise<Response> {
  const limit = Math.min(100, parseInt(url.searchParams.get("limit") || "50"));
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id, prompt, response_text, model, provider, user_id, scope, hit_count, created_at, expires_at
       FROM sb_prompt_cache ORDER BY created_at DESC LIMIT $1`,
    limit,
  );
  return Response.json({
    entries: rows.map((r: any) => ({
      id: Number(r.id), prompt: r.prompt.slice(0, 300),
      response_preview: r.response_text.slice(0, 300),
      model: r.model, provider: r.provider, user_id: r.user_id, scope: r.scope,
      hit_count: Number(r.hit_count),
      created_at: Number(r.created_at), expires_at: Number(r.expires_at),
    })),
  });
}

async function handleClearCache(req: Request): Promise<Response> {
  const body = await req.json().catch(() => ({})) as any;
  if (body?.user_id) {
    await prisma.$executeRawUnsafe(`DELETE FROM sb_prompt_cache WHERE user_id = $1`, body.user_id);
  } else if (body?.expired_only) {
    await prisma.$executeRawUnsafe(`DELETE FROM sb_prompt_cache WHERE expires_at <= $1`, BigInt(Date.now()));
  } else {
    await prisma.$executeRawUnsafe(`DELETE FROM sb_prompt_cache`);
  }
  triggerBroadcast();
  return Response.json({ ok: true });
}

async function handleBackfill(req: Request): Promise<Response> {
  const body = await req.json().catch(() => ({})) as any;
  const limit = Math.min(2000, parseInt(body?.limit) || 500);
  // Fire in background — return immediately. Client polls overview for progress.
  void backfillFromLogs(limit).catch((e: any) => console.error("[second-brain.backfill] failed:", e?.message ?? e));
  return Response.json({ ok: true, scheduled: limit });
}

async function backfillFromLogs(limit: number): Promise<void> {
  const { embedText: embed } = await import("./embedding");
  const { writeCache } = await import("./cache");
  const cfg = effectiveConfig();
  const ttlMs = Math.max(60_000, cfg.cacheTtlHours * 3600_000);
  console.log(`[second-brain.backfill] starting, limit=${limit}`);
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id, prompt, response_text, model, user_id, input_tokens, output_tokens
       FROM request_logs
      WHERE status = 200 AND length(prompt) >= 50 AND length(response_text) >= 50
      ORDER BY ts DESC LIMIT $1`,
    limit,
  );
  let ok = 0, skip = 0, fail = 0;
  for (const r of rows) {
    try {
      const vec = await embed(r.prompt);
      await writeCache({
        prompt: r.prompt, promptVec: vec,
        responseText: r.response_text,
        inputTokens: r.input_tokens || 0, outputTokens: r.output_tokens || 0,
        model: r.model || "", provider: "anthropic",
        userId: r.user_id || "", scope: "user", ttlMs,
      });
      ok++;
    } catch (e: any) { fail++; if (fail < 5) console.warn("[second-brain.backfill] row failed:", e?.message ?? e); }
  }
  console.log(`[second-brain.backfill] done: ok=${ok} skip=${skip} fail=${fail}`);
}

function safeJson(s: string): any {
  try { return JSON.parse(s); } catch { return s; }
}
