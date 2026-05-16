import { createHash } from "node:crypto";
import { prisma } from "../../prisma";
import { vectorLiteral } from "./embedding";

export const MIN_CACHEABLE_LENGTH = 30;

export interface CachedEntry {
  id:            bigint;
  prompt:        string;
  response_text: string;
  input_tokens:  number;
  output_tokens: number;
  model:         string;
  similarity:    number;
  hit_count:     number;
}

export function hashPrompt(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export async function lookupCacheExact(promptHash: string, userId: string, scope: string): Promise<CachedEntry | null> {
  const now = BigInt(Date.now());
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id, prompt, response_text, input_tokens, output_tokens, model, hit_count
       FROM sb_prompt_cache
      WHERE prompt_hash = $1
        AND expires_at > $2
        AND (scope = 'shared' OR (scope = 'user' AND user_id = $3))
      LIMIT 1`,
    promptHash, now, userId
  );
  if (!rows.length) return null;
  const r = rows[0];
  await prisma.$executeRawUnsafe(`UPDATE sb_prompt_cache SET hit_count = hit_count + 1 WHERE id = $1`, r.id);
  return {
    id: r.id, prompt: r.prompt, response_text: r.response_text,
    input_tokens: r.input_tokens, output_tokens: r.output_tokens,
    model: r.model, hit_count: Number(r.hit_count) + 1, similarity: 1.0,
  };
}

export async function lookupCacheSimilar(
  promptVec: number[], userId: string, scope: string, threshold: number,
): Promise<CachedEntry | null> {
  const now = BigInt(Date.now());
  const vec = vectorLiteral(promptVec);
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id, prompt, response_text, input_tokens, output_tokens, model, hit_count,
            1 - (embedding <=> $1::vector) AS similarity
       FROM sb_prompt_cache
      WHERE expires_at > $2
        AND (scope = 'shared' OR (scope = 'user' AND user_id = $3))
        AND embedding IS NOT NULL
      ORDER BY embedding <=> $1::vector
      LIMIT 1`,
    vec, now, userId
  );
  if (!rows.length) return null;
  const r = rows[0];
  const sim = Number(r.similarity);
  if (sim < threshold) return null;
  await prisma.$executeRawUnsafe(`UPDATE sb_prompt_cache SET hit_count = hit_count + 1 WHERE id = $1`, r.id);
  return {
    id: r.id, prompt: r.prompt, response_text: r.response_text,
    input_tokens: r.input_tokens, output_tokens: r.output_tokens,
    model: r.model, hit_count: Number(r.hit_count) + 1, similarity: sim,
  };
}

export interface WriteCacheOpts {
  prompt:        string;
  promptVec:     number[];
  responseText:  string;
  inputTokens:   number;
  outputTokens:  number;
  model:         string;
  provider:      string;
  userId:        string;
  scope:         string;
  ttlMs:         number;
}

export async function writeCache(opts: WriteCacheOpts): Promise<void> {
  const now     = BigInt(Date.now());
  const expires = BigInt(Date.now() + opts.ttlMs);
  const hash    = hashPrompt(opts.prompt);
  const vec     = vectorLiteral(opts.promptVec);
  await prisma.$executeRawUnsafe(
    `INSERT INTO sb_prompt_cache
      (prompt_hash, prompt, embedding, response_text, response_body,
       input_tokens, output_tokens, model, provider, user_id, scope, created_at, expires_at)
     VALUES ($1, $2, $3::vector, $4, '', $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (prompt_hash) DO UPDATE SET
       response_text = EXCLUDED.response_text,
       embedding     = EXCLUDED.embedding,
       input_tokens  = EXCLUDED.input_tokens,
       output_tokens = EXCLUDED.output_tokens,
       model         = EXCLUDED.model,
       provider      = EXCLUDED.provider,
       expires_at    = EXCLUDED.expires_at`,
    hash, opts.prompt, vec, opts.responseText, opts.inputTokens, opts.outputTokens,
    opts.model, opts.provider, opts.userId, opts.scope, now, expires
  );
}

export function synthesizeResponse(
  text:         string,
  model:        string,
  inputTokens:  number,
  outputTokens: number,
  isStream:     boolean,
  similarity:   number,
): Response {
  if (isStream) {
    const id = "msg_sbcache_" + Date.now().toString(36);
    const sse = [
      `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { id, type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: inputTokens, output_tokens: 0 } } })}\n\n`,
      `event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })}\n\n`,
      `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } })}\n\n`,
      `event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: 0 })}\n\n`,
      `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: outputTokens } })}\n\n`,
      `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`,
    ].join("");
    return new Response(sse, {
      status: 200,
      headers: {
        "content-type":       "text/event-stream",
        "cache-control":      "no-cache",
        "x-accel-buffering":  "no",
        "x-sb-cache":         "HIT",
        "x-sb-similarity":    similarity.toFixed(4),
      },
    });
  }
  return Response.json({
    id:            "msg_sbcache_" + Date.now().toString(36),
    type:          "message",
    role:          "assistant",
    model,
    content:       [{ type: "text", text }],
    stop_reason:   "end_turn",
    stop_sequence: null,
    usage:         { input_tokens: inputTokens, output_tokens: outputTokens },
  }, {
    status: 200,
    headers: {
      "x-sb-cache":      "HIT",
      "x-sb-similarity": similarity.toFixed(4),
    },
  });
}
