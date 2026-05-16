import type { ProxyContext, PostRequestContext, PreRequestResult } from "../types";
import { getConfig } from "../registry";
import {
  hashPrompt, lookupCacheExact, lookupCacheSimilar, writeCache, synthesizeResponse,
  MIN_CACHEABLE_LENGTH,
} from "./cache";
import { embedText } from "./embedding";
import { logEvent } from "./lifecycle";
import { defaultConfig, type SecondBrainConfig } from "./config";
import { canMineForUser, enqueueMining } from "./worker";
import {
  retrieveRelevantStrategies, injectStrategiesIntoBody,
  markStrategiesUsed, markStrategiesOutcome,
} from "./strategies";

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

// Extract system prompt text (handles both string and content-block forms).
function extractSystem(bodyJson: any): string {
  const s = bodyJson?.system;
  if (!s) return "";
  if (typeof s === "string") return s.slice(0, 4000);
  if (Array.isArray(s)) {
    return s.filter((b: any) => b?.type === "text").map((b: any) => b.text || "").join("\n").slice(0, 4000);
  }
  return "";
}

// Build the FULL context signature used as cache key. Without this, two requests
// with the same final user-text but different conversation context would collide
// in the cache (false positives — user sees a stale response from another
// session). The key now encodes:
//   - model name (different model = different output expected)
//   - system prompt text
//   - all messages text concatenated with role markers
// This makes the cache effectively memoization of *identical* requests only.
// For incremental chat (where every turn adds a message) the key changes each
// turn, so the cache only ever hits on true replays — which is the correct
// semantics for a content-addressed cache.
function buildContextSignature(bodyJson: any, prompt: string): string {
  const parts: string[] = [];
  parts.push("model:" + (bodyJson?.model || ""));
  parts.push("sys:"   + extractSystem(bodyJson));
  const msgs = Array.isArray(bodyJson?.messages) ? bodyJson.messages : [];
  // Walk messages and dump role + text (per-msg truncated, total bounded).
  let msgsBudget = 16_000;
  for (const m of msgs) {
    if (msgsBudget <= 0) break;
    const role = m?.role || "user";
    const c = m?.content;
    let text = "";
    if (typeof c === "string") text = c;
    else if (Array.isArray(c)) {
      text = c.filter((b: any) => b?.type === "text").map((b: any) => b.text || "").join("\n");
    }
    if (!text) continue;
    const slice = text.slice(0, Math.min(2000, msgsBudget));
    parts.push(`[${role}]${slice}`);
    msgsBudget -= slice.length;
  }
  parts.push("last:" + prompt);
  return parts.join("\n");
}

function isStreaming(bodyJson: any): boolean {
  return bodyJson?.stream === true;
}

function effectiveScope(cfg: SecondBrainConfig): "user" | "shared" {
  return cfg.scope === "shared" ? "shared" : "user";
}

export async function preRequest(ctx: ProxyContext): Promise<PreRequestResult | null> {
  const cfg = getMergedConfig();
  if (!cfg.cacheEnabled && !cfg.injectionEnabled) return null;

  const prompt = extractPrompt(ctx.messages);
  if (prompt.length < MIN_CACHEABLE_LENGTH) return null;

  const userId = ctx.token.user_id || "";
  const scope  = effectiveScope(cfg);
  const stream = isStreaming(ctx.bodyJson);

  // Build full context signature for exact-match cache key. This includes
  // system prompt + all messages + last user text — prevents collisions
  // where two unrelated requests share the same final user message.
  const contextSig = buildContextSignature(ctx.bodyJson, prompt);

  // 1. Exact hash lookup — free, no embedding (cache only)
  if (cfg.cacheEnabled) {
    const hash = hashPrompt(contextSig);
    try {
      const exact = await lookupCacheExact(hash, userId, scope);
      if (exact) {
        logEvent("cache_hit_exact", { model: exact.model, prompt_len: prompt.length, response_len: exact.response_text.length, hit_count: exact.hit_count }, userId).catch(() => {});
        console.log(`[second-brain] cache HIT (exact) user=${userId} model=${exact.model} prompt_len=${prompt.length} ctx_len=${contextSig.length}`);
        return { intercept: synthesizeResponse(exact.response_text, ctx.model || exact.model, exact.input_tokens, exact.output_tokens, stream, 1.0) };
      }
    } catch (e: any) {
      console.warn("[second-brain] exact lookup failed:", e?.message ?? e);
    }
  }

  // 2. Embed the FULL context signature (not just the last user text) so
  //    semantic similarity also accounts for system prompt + history. This
  //    closes the same loophole as the exact-hash fix.
  let vec: number[] | null = null;
  try { vec = await embedText(contextSig.slice(0, 8000)); }
  catch (e: any) { console.warn("[second-brain] embed failed:", e?.message ?? e); }

  // 3. Semantic similarity cache lookup
  if (cfg.cacheEnabled && vec) {
    try {
      const similar = await lookupCacheSimilar(vec, userId, scope, cfg.cacheSimilarityThreshold);
      if (similar) {
        logEvent("cache_hit_semantic", { model: similar.model, similarity: similar.similarity, prompt_len: prompt.length, response_len: similar.response_text.length, hit_count: similar.hit_count }, userId).catch(() => {});
        console.log(`[second-brain] cache HIT (semantic ${similar.similarity.toFixed(3)}) user=${userId} model=${similar.model}`);
        return { intercept: synthesizeResponse(similar.response_text, ctx.model || similar.model, similar.input_tokens, similar.output_tokens, stream, similar.similarity) };
      }
    } catch (e: any) {
      console.warn("[second-brain] semantic lookup failed:", e?.message ?? e);
    }
  }

  // Stash for postRequest reuse — context signature is what we'll hash on write
  (ctx as any).__sb_prompt       = prompt;
  (ctx as any).__sb_context_sig  = contextSig;
  (ctx as any).__sb_embedding    = vec;
  if (cfg.cacheEnabled) logEvent("cache_miss", { prompt_len: prompt.length, has_embedding: !!vec }, userId).catch(() => {});

  // 4. Strategy injection — only for non-Anthropic providers (cheap model boost)
  if (cfg.injectionEnabled && vec && ctx.provider && ctx.provider !== "anthropic") {
    try {
      const strategies = await retrieveRelevantStrategies(vec, userId, scope, cfg.injectionTopK, 0.55);
      if (strategies.length) {
        const modified = injectStrategiesIntoBody(ctx.bodyJson, strategies);
        const ids = strategies.map(s => s.id);
        (ctx as any).__sb_injected_ids = ids;
        markStrategiesUsed(ids).catch(() => {});
        logEvent("strategy_injected", {
          provider: ctx.provider, model: ctx.model,
          strategy_ids: ids, strategy_count: strategies.length,
          top_similarity: strategies[0]?.similarity,
        }, userId).catch(() => {});
        console.log(`[second-brain] injected ${strategies.length} strategies into ${ctx.provider} request (top sim=${strategies[0]?.similarity?.toFixed(3)})`);
        return { modifiedBody: modified };
      }
    } catch (e: any) {
      console.warn("[second-brain] strategy injection failed:", e?.message ?? e);
    }
  }

  return null;
}

export async function postRequest(ctx: ProxyContext, post: PostRequestContext): Promise<void> {
  const cfg = getMergedConfig();

  // Track strategy outcome regardless of cache state — for injection effectiveness scoring
  const injectedIds = (ctx as any).__sb_injected_ids as string[] | undefined;
  if (injectedIds?.length) {
    const success = post.status === 200 && post.responseText.length >= 20;
    markStrategiesOutcome(injectedIds, success).catch(() => {});
    logEvent(success ? "strategy_used_success" : "strategy_used_fail", {
      strategy_ids: injectedIds, status: post.status, provider: ctx.provider, model: ctx.model,
    }, ctx.token.user_id || "").catch(() => {});
  }

  if (!cfg.cacheEnabled) return;
  if (post.status !== 200) return;
  if (!post.responseText || post.responseText.length < 20) return;

  const prompt     = (ctx as any).__sb_prompt      as string | undefined;
  const contextSig = (ctx as any).__sb_context_sig as string | undefined;
  let   vec        = (ctx as any).__sb_embedding   as number[] | null | undefined;
  if (!prompt || !contextSig) return;

  if (!vec) {
    try { vec = await embedText(contextSig.slice(0, 8000)); }
    catch (e: any) { console.warn("[second-brain] post-embed failed:", e?.message ?? e); return; }
  }

  const userId = ctx.token.user_id || "";
  const scope  = effectiveScope(cfg);
  const ttlMs  = Math.max(60_000, cfg.cacheTtlHours * 3600_000);

  try {
    // Write uses the FULL context signature as the key text — same as lookup.
    // The `prompt` field stores the user-visible last message for display only.
    await writeCache({
      prompt:       contextSig,         // hashed → used for prompt_hash + embedding match
      displayPrompt: prompt,            // shown in admin UI
      promptVec:    vec,
      responseText: post.responseText,
      inputTokens:  post.inputTokens,
      outputTokens: post.outputTokens,
      model:        ctx.model || "",
      provider:     ctx.provider || "",
      userId, scope, ttlMs,
    });
    logEvent("cache_write", { model: ctx.model, provider: ctx.provider, prompt_len: prompt.length, context_len: contextSig.length, response_len: post.responseText.length }, userId).catch(() => {});
  } catch (e: any) {
    console.warn("[second-brain] cache write failed:", e?.message ?? e);
  }

  // ── Strategy mining (Lapis 2): enqueue if substantive + throttle allows ──
  if (cfg.miningEnabled && qualifiesForMining(ctx, post)) {
    try {
      if (await canMineForUser(userId)) {
        const trajectory = extractTrajectory(ctx.messages);
        const jobId = await enqueueMining({
          request_log_id: 0,
          prompt, response_text: post.responseText, trajectory,
          model: ctx.model || "",
          user_id: userId,
          project: "",
        });
        if (jobId) {
          logEvent("mine_enqueued", { job_id: jobId, model: ctx.model, prompt_len: prompt.length, traj_len: trajectory.length }, userId).catch(() => {});
        }
      }
    } catch (e: any) {
      console.warn("[second-brain] mine enqueue failed:", e?.message ?? e);
    }
  }
}

function qualifiesForMining(ctx: ProxyContext, post: PostRequestContext): boolean {
  const turns = Array.isArray(ctx.bodyJson?.messages) ? ctx.bodyJson.messages.length : 0;
  return post.outputTokens >= 50
      && post.responseText.length >= 200
      && turns >= 2;
}

function extractTrajectory(messages: any[]): string {
  if (!Array.isArray(messages)) return "";
  const parts: string[] = [];
  for (const m of messages.slice(-10)) {
    const role = m?.role || "user";
    const c = m?.content;
    let text = "";
    if (typeof c === "string") text = c;
    else if (Array.isArray(c)) text = c.filter((b: any) => b?.type === "text").map((b: any) => b.text || "").join("\n");
    if (text.trim()) parts.push(`[${role}]\n${text.slice(0, 3000)}`);
  }
  return parts.join("\n\n").slice(0, 8000);
}
