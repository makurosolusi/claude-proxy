import type { ProxyContext, PostRequestContext, PreRequestResult } from "../types";
import { getConfig } from "../registry";
import { embedText } from "./embedding";
import { logEvent } from "./lifecycle";
import { defaultConfig, type SecondBrainConfig } from "./config";
import { canMineForUser, enqueueMining } from "./worker";
import {
  retrieveRelevantStrategies, injectStrategiesIntoBody,
  markStrategiesUsed, markStrategiesOutcome,
} from "./strategies";

// Minimum prompt length for the embedding+retrieval path. Very short prompts
// (single word, "ok", "?", etc.) have noisy embeddings and would match anything.
const MIN_PROMPT_LENGTH = 30;

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

function effectiveScope(cfg: SecondBrainConfig): "user" | "shared" {
  return cfg.scope === "shared" ? "shared" : "user";
}

// preRequest: only purpose now is strategy injection for non-Anthropic providers.
// Cache feature was removed — it caused stale-response bugs and provided no real
// benefit in interactive chat use cases.
export async function preRequest(ctx: ProxyContext): Promise<PreRequestResult | null> {
  const cfg = getMergedConfig();
  if (!cfg.injectionEnabled) return null;
  if (!ctx.provider || ctx.provider === "anthropic") return null; // injection targets cheap providers only

  const prompt = extractPrompt(ctx.messages);
  if (prompt.length < MIN_PROMPT_LENGTH) return null;

  let vec: number[] | null = null;
  try { vec = await embedText(prompt); }
  catch (e: any) { console.warn("[second-brain] embed failed:", e?.message ?? e); return null; }
  if (!vec) return null;

  const userId = ctx.token.user_id || "";
  const scope  = effectiveScope(cfg);

  try {
    const strategies = await retrieveRelevantStrategies(vec, userId, scope, cfg.injectionTopK, 0.55);
    if (!strategies.length) return null;
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
    // Stash prompt for postRequest mining
    (ctx as any).__sb_prompt = prompt;
    return { modifiedBody: modified };
  } catch (e: any) {
    console.warn("[second-brain] strategy injection failed:", e?.message ?? e);
    return null;
  }
}

// postRequest: track injection outcome + enqueue mining for substantive sessions.
// No cache writes anymore.
export async function postRequest(ctx: ProxyContext, post: PostRequestContext): Promise<void> {
  const cfg = getMergedConfig();

  // Track strategy outcome — informs effectiveness scoring + future retrieval
  const injectedIds = (ctx as any).__sb_injected_ids as string[] | undefined;
  if (injectedIds?.length) {
    const success = post.status === 200 && post.responseText.length >= 20;
    markStrategiesOutcome(injectedIds, success).catch(() => {});
    logEvent(success ? "strategy_used_success" : "strategy_used_fail", {
      strategy_ids: injectedIds, status: post.status, provider: ctx.provider, model: ctx.model,
    }, ctx.token.user_id || "").catch(() => {});
  }

  if (!cfg.miningEnabled) return;
  if (post.status !== 200) return;
  if (!qualifiesForMining(ctx, post)) return;

  const userId = ctx.token.user_id || "";
  if (!(await canMineForUser(userId))) return;

  // Re-extract prompt if it wasn't stashed (injection path skipped for anthropic requests)
  let prompt = (ctx as any).__sb_prompt as string | undefined;
  if (!prompt) prompt = extractPrompt(ctx.messages);
  if (!prompt || prompt.length < MIN_PROMPT_LENGTH) return;

  try {
    const trajectory = extractTrajectory(ctx.messages);
    const jobId = await enqueueMining({
      request_log_id: 0,
      prompt, response_text: post.responseText, trajectory,
      model:    ctx.model || "",
      user_id:  userId,
      project:  "",
    });
    if (jobId) {
      logEvent("mine_enqueued", { job_id: jobId, model: ctx.model, prompt_len: prompt.length, traj_len: trajectory.length }, userId).catch(() => {});
    }
  } catch (e: any) {
    console.warn("[second-brain] mine enqueue failed:", e?.message ?? e);
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
