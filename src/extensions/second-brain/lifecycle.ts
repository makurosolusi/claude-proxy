import { prisma } from "../../prisma";
import { CREATE_PGVECTOR_SQL, CREATE_TABLES_SQL } from "./schema";
import { initEmbedding } from "./embedding";
import type { EnableResult } from "../types";

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
