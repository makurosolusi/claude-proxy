import { prisma } from "../../prisma";
import { CREATE_PGVECTOR_SQL, CREATE_TABLES_SQL } from "./schema";
import { initEmbedding } from "./embedding";
import { settings, dbSaveSetting } from "../../state";
import type { EnableResult } from "../types";

// Bump this when the cache key scheme changes — on next enable, stale entries
// hashed under an older scheme are wiped to prevent collision-driven false hits.
// v1 = hash on last user message text only (had collision bug).
// v2 = hash on full context signature (system + all messages + last user).
const CACHE_KEY_SCHEME = "v2";

export async function onEnable(): Promise<EnableResult> {
  try {
    await prisma.$executeRawUnsafe(CREATE_PGVECTOR_SQL);
  } catch (e: any) {
    return {
      ok: false,
      error: "pgvector extension unavailable. Swap Postgres image to pgvector/pgvector:pg16 OR install postgresql-16-pgvector. Detail: " + (e?.message ?? e),
    };
  }

  for (const stmt of CREATE_TABLES_SQL) {
    try { await prisma.$executeRawUnsafe(stmt); }
    catch (e: any) {
      return { ok: false, error: `Schema setup failed: ${e?.message ?? e} (stmt: ${stmt.slice(0, 60)}...)` };
    }
  }

  const check = await prisma.$queryRawUnsafe<{ exists: string | null }[]>(
    "SELECT to_regclass('public.sb_strategies')::text AS exists"
  );
  if (!check?.[0]?.exists) {
    return { ok: false, error: "Verification failed: sb_strategies table not present after creation" };
  }

  // One-shot cache invalidation on key scheme upgrade. Skipped after first run.
  const installedScheme = settings["sb_cache_key_scheme"] || "v1";
  if (installedScheme !== CACHE_KEY_SCHEME) {
    try {
      const deleted = await prisma.$executeRawUnsafe(`DELETE FROM sb_prompt_cache`);
      await dbSaveSetting("sb_cache_key_scheme", CACHE_KEY_SCHEME);
      console.log(`[second-brain] cache scheme upgrade ${installedScheme} → ${CACHE_KEY_SCHEME}: invalidated ${deleted} stale entries`);
      await logEvent("cache_scheme_upgrade", { from: installedScheme, to: CACHE_KEY_SCHEME, deleted }).catch(() => {});
    } catch (e: any) {
      console.warn("[second-brain] cache scheme upgrade failed:", e?.message ?? e);
    }
  }

  // Fire-and-forget embedding model warm — first call may need ~30s download.
  // Subsequent calls within the process are <100ms.
  initEmbedding().catch(e => console.warn("[second-brain] embedding warm failed:", e?.message ?? e));

  await logEvent("enable", { ts: Date.now() }).catch(() => {});
  console.log("[second-brain] enabled: schema verified, pgvector available, model warming");
  return { ok: true };
}

export async function onDisable(): Promise<void> {
  await logEvent("disable", { ts: Date.now() }).catch(() => {});
  console.log("[second-brain] disabled — schema preserved, hooks inert");
}

export async function logEvent(eventType: string, detail: Record<string, any> = {}, userId = ""): Promise<void> {
  try {
    await prisma.$executeRaw`
      INSERT INTO sb_extension_logs (ts, event_type, detail, user_id)
      VALUES (${BigInt(Date.now())}, ${eventType}, ${JSON.stringify(detail)}, ${userId})
    `;
  } catch (e: any) {
    console.warn("[second-brain] logEvent failed:", e?.message ?? e);
  }
}
