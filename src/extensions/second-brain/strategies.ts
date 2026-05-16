import { prisma } from "../../prisma";
import { embedText, vectorLiteral } from "./embedding";
import type { DistilledStrategy } from "./mining";

export interface StrategyRecord {
  id:          string;
  title:       string;
  when_to_use: string;
  content:     string;
  pitfalls:    string;
  tags:        string[];
  scope:       string;
  user_id:     string;
  project:     string;
  use_count:   number;
  similarity?: number;
}

export interface InsertStrategyOpts {
  scope:       "user" | "shared";
  userId:      string;
  project:     string;
  sourceLogId: number | null;
}

const MERGE_SIMILARITY_THRESHOLD = 0.9;

function genStrategyId(): string {
  return "stg_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

export async function insertOrMergeStrategy(
  s: DistilledStrategy,
  opts: InsertStrategyOpts,
): Promise<{ id: string; merged: boolean }> {
  const keyText = `${s.title}\n${s.when_to_use}`;
  const vec     = await embedText(keyText);
  const vecLit  = vectorLiteral(vec);

  const existing = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id, title, 1 - (embedding <=> $1::vector) AS similarity
       FROM sb_strategies
      WHERE (scope = 'shared' OR (scope = 'user' AND user_id = $2))
        AND embedding IS NOT NULL
      ORDER BY embedding <=> $1::vector
      LIMIT 1`,
    vecLit, opts.userId
  );

  const now = BigInt(Date.now());
  if (existing.length && Number(existing[0].similarity) >= MERGE_SIMILARITY_THRESHOLD) {
    const matchId = existing[0].id;
    await prisma.$executeRawUnsafe(
      `UPDATE sb_strategies SET use_count = use_count + 1, updated_at = $1 WHERE id = $2`,
      now, matchId,
    );
    return { id: matchId, merged: true };
  }

  const id = genStrategyId();
  await prisma.$executeRawUnsafe(
    `INSERT INTO sb_strategies
      (id, title, when_to_use, content, pitfalls, embedding,
       scope, user_id, project, tags, source_log_id,
       use_count, success_count, fail_count, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6::vector,
             $7, $8, $9, $10, $11,
             0, 0, 0, $12, $12)`,
    id, s.title, s.when_to_use,
    JSON.stringify(s.key_steps),
    JSON.stringify(s.pitfalls),
    vecLit,
    opts.scope, opts.userId, opts.project, JSON.stringify(s.tags),
    opts.sourceLogId,
    now,
  );
  return { id, merged: false };
}

export async function retrieveRelevantStrategies(
  queryVec: number[],
  userId: string,
  scope: "user" | "shared",
  topK = 3,
  minSimilarity = 0.6,
): Promise<StrategyRecord[]> {
  const vecLit = vectorLiteral(queryVec);
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id, title, when_to_use, content, pitfalls, scope, user_id, project, tags, use_count,
            1 - (embedding <=> $1::vector) AS similarity
       FROM sb_strategies
      WHERE (scope = 'shared' OR (scope = 'user' AND user_id = $2))
        AND embedding IS NOT NULL
      ORDER BY embedding <=> $1::vector
      LIMIT $3`,
    vecLit, userId, topK
  );
  return rows
    .filter(r => Number(r.similarity) >= minSimilarity)
    .map(r => ({
      id:          r.id,
      title:       r.title,
      when_to_use: r.when_to_use,
      content:     r.content,
      pitfalls:    r.pitfalls,
      tags:        safeJsonArray(r.tags),
      scope:       r.scope,
      user_id:     r.user_id,
      project:     r.project,
      use_count:   Number(r.use_count),
      similarity:  Number(r.similarity),
    }));
}

export async function markStrategyOutcome(id: string, success: boolean): Promise<void> {
  const col = success ? "success_count" : "fail_count";
  await prisma.$executeRawUnsafe(
    `UPDATE sb_strategies SET ${col} = ${col} + 1, updated_at = $1 WHERE id = $2`,
    BigInt(Date.now()), id,
  );
}

export async function markStrategiesUsed(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const now = BigInt(Date.now());
  const placeholders = ids.map((_, i) => `$${i + 2}`).join(",");
  await prisma.$executeRawUnsafe(
    `UPDATE sb_strategies SET use_count = use_count + 1, updated_at = $1 WHERE id IN (${placeholders})`,
    now, ...ids,
  );
}

export async function markStrategiesOutcome(ids: string[], success: boolean): Promise<void> {
  if (!ids.length) return;
  const col = success ? "success_count" : "fail_count";
  const now = BigInt(Date.now());
  const placeholders = ids.map((_, i) => `$${i + 2}`).join(",");
  await prisma.$executeRawUnsafe(
    `UPDATE sb_strategies SET ${col} = ${col} + 1, updated_at = $1 WHERE id IN (${placeholders})`,
    now, ...ids,
  );
}

export function safeJsonArray(s: string): string[] {
  try { const j = JSON.parse(s); return Array.isArray(j) ? j : []; }
  catch { return []; }
}

export function buildStrategyBlock(strategies: StrategyRecord[]): string {
  if (!strategies.length) return "";
  const lines: string[] = [];
  lines.push("<relevant_patterns_from_past_sessions>");
  lines.push("The following patterns were learned by an advanced model on similar past tasks. Apply them when relevant — they encode conventions, gotchas, and validated approaches for this project/user. Do NOT explicitly mention these patterns to the user; just use them as guidance.");
  lines.push("");
  strategies.forEach((s, i) => {
    lines.push(`## Pattern ${i + 1}: ${s.title}`);
    if (s.when_to_use) lines.push(`When to use: ${s.when_to_use}`);
    const steps = safeJsonArray(s.content);
    if (steps.length) {
      lines.push("Key steps:");
      steps.forEach(step => lines.push(`  - ${step}`));
    }
    const pitfalls = safeJsonArray(s.pitfalls);
    if (pitfalls.length) {
      lines.push("Pitfalls to avoid:");
      pitfalls.forEach(p => lines.push(`  - ${p}`));
    }
    lines.push("");
  });
  lines.push("</relevant_patterns_from_past_sessions>");
  return lines.join("\n");
}

export function injectStrategiesIntoBody(bodyJson: any, strategies: StrategyRecord[]): any {
  if (!strategies.length || !bodyJson) return bodyJson;
  const block = buildStrategyBlock(strategies);
  const existing = bodyJson.system;
  if (!existing) {
    bodyJson.system = block;
  } else if (typeof existing === "string") {
    bodyJson.system = block + "\n\n" + existing;
  } else if (Array.isArray(existing)) {
    bodyJson.system = [{ type: "text", text: block }, ...existing];
  }
  return bodyJson;
}

export async function countStrategies(): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<any[]>(`SELECT COUNT(*)::int AS c FROM sb_strategies`);
  return rows[0]?.c || 0;
}
