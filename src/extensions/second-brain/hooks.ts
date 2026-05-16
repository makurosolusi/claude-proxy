import type { ProxyContext, PostRequestContext, PreRequestResult } from "../types";
import { getConfig } from "../registry";
import {
  hashPrompt, lookupCacheExact, lookupCacheSimilar, writeCache, synthesizeResponse,
  MIN_CACHEABLE_LENGTH,
} from "./cache";
import { embedText } from "./embedding";
import { logEvent } from "./lifecycle";
import { defaultConfig, type SecondBrainConfig } from "./config";

function getMergedConfig(): SecondBrainConfig {
  const stored = getConfig("second-brain") || {};
  return { ...defaultConfig, ...(stored as Partial<SecondBrainConfig>) };
}

function extractPrompt(messages: any[]): string {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== "user") continue;
    const c = m.content;
    if (typeof c === "string") {
      const trimmed = c.trim();
      if (trimmed) return trimmed.slice(0, 4000);
      continue;
    }
    if (Array.isArray(c)) {
      const text = c.filter((b: any) => b?.type === "text").map((b: any) => b.text || "").join("\n").trim();
      if (text) return text.slice(0, 4000);
    }
  }
  return "";
}

function isStreaming(bodyJson: any): boolean {
  return bodyJson?.stream === true;
}

function effectiveScope(cfg: SecondBrainConfig): "user" | "shared" {
  return cfg.scope === "shared" ? "shared" : "user";
}

export async function preRequest(ctx: ProxyContext): Promise<PreRequestResult | null> {
  const cfg = getMergedConfig();
  if (!cfg.cacheEnabled) return null;

  const prompt = extractPrompt(ctx.messages);
  if (prompt.length < MIN_CACHEABLE_LENGTH) return null;

  const userId = ctx.token.user_id || "";
  const scope  = effectiveScope(cfg);
  const stream = isStreaming(ctx.bodyJson);

  // 1. Exact hash lookup — free, no embedding
  const hash = hashPrompt(prompt);
  try {
    const exact = await lookupCacheExact(hash, userId, scope);
    if (exact) {
      logEvent("cache_hit_exact", { model: exact.model, prompt_len: prompt.length, response_len: exact.response_text.length, hit_count: exact.hit_count }, userId).catch(() => {});
      console.log(`[second-brain] cache HIT (exact) user=${userId} model=${exact.model} prompt_len=${prompt.length}`);
      return { intercept: synthesizeResponse(exact.response_text, ctx.model || exact.model, exact.input_tokens, exact.output_tokens, stream, 1.0) };
    }
  } catch (e: any) {
    console.warn("[second-brain] exact lookup failed:", e?.message ?? e);
  }

  // 2. Semantic similarity lookup
  let vec: number[] | null = null;
  try {
    vec = await embedText(prompt);
    const similar = await lookupCacheSimilar(vec, userId, scope, cfg.cacheSimilarityThreshold);
    if (similar) {
      logEvent("cache_hit_semantic", { model: similar.model, similarity: similar.similarity, prompt_len: prompt.length, response_len: similar.response_text.length, hit_count: similar.hit_count }, userId).catch(() => {});
      console.log(`[second-brain] cache HIT (semantic ${similar.similarity.toFixed(3)}) user=${userId} model=${similar.model}`);
      return { intercept: synthesizeResponse(similar.response_text, ctx.model || similar.model, similar.input_tokens, similar.output_tokens, stream, similar.similarity) };
    }
  } catch (e: any) {
    console.warn("[second-brain] semantic lookup failed:", e?.message ?? e);
  }

  // Cache miss — stash prompt + vec on ctx for postRequest reuse
  (ctx as any).__sb_prompt    = prompt;
  (ctx as any).__sb_embedding = vec;
  logEvent("cache_miss", { prompt_len: prompt.length, has_embedding: !!vec }, userId).catch(() => {});
  return null;
}

export async function postRequest(ctx: ProxyContext, post: PostRequestContext): Promise<void> {
  const cfg = getMergedConfig();
  if (!cfg.cacheEnabled) return;
  if (post.status !== 200) return;
  if (!post.responseText || post.responseText.length < 20) return;

  const prompt = (ctx as any).__sb_prompt as string | undefined;
  let   vec    = (ctx as any).__sb_embedding as number[] | null | undefined;
  if (!prompt) return;

  if (!vec) {
    try { vec = await embedText(prompt); }
    catch (e: any) { console.warn("[second-brain] post-embed failed:", e?.message ?? e); return; }
  }

  const userId = ctx.token.user_id || "";
  const scope  = effectiveScope(cfg);
  const ttlMs  = Math.max(60_000, cfg.cacheTtlHours * 3600_000);

  try {
    await writeCache({
      prompt, promptVec: vec,
      responseText: post.responseText,
      inputTokens:  post.inputTokens,
      outputTokens: post.outputTokens,
      model:        ctx.model || "",
      provider:     ctx.provider || "",
      userId, scope, ttlMs,
    });
    logEvent("cache_write", { model: ctx.model, provider: ctx.provider, prompt_len: prompt.length, response_len: post.responseText.length }, userId).catch(() => {});
  } catch (e: any) {
    console.warn("[second-brain] cache write failed:", e?.message ?? e);
  }
}
