import { config } from "../../config";
import { getOauthCredential, hasAnthropicCredential } from "../../upstream";
import { settings } from "../../state";
import { getProviderAvailability } from "../../providerSelection";
import type { MiningProvider } from "./config";

export interface DistilledStrategy {
  title:        string;
  when_to_use:  string;
  key_steps:    string[];
  pitfalls:     string[];
  tags:         string[];
  skip?:        false;
}

export interface SkippedDistillation {
  skip:   true;
  reason: string;
}

export type DistillResult = DistilledStrategy | SkippedDistillation;

const DISTILL_SYSTEM = `You are a strategy distiller. Read a coding-session trajectory and distill ONE reusable, high-level strategy item. Output ONLY valid JSON, no preamble, no markdown fences.

Schema for valid strategy:
{
  "title": "imperative phrase (max 80 chars)",
  "when_to_use": "trigger conditions (max 200 chars)",
  "key_steps": ["step", ...] (max 5, each <120 chars),
  "pitfalls": ["pitfall", ...] (max 3, each <120 chars),
  "tags": ["tag", ...] (max 4, single-word lowercase)
}

Schema when trajectory is unsuitable (short, error-only, chitchat, throwaway):
{ "skip": true, "reason": "..." }

Skip if:
- Trajectory is <100 chars total
- Session is just error messages or stack traces
- Conversational/help-desk only (no concrete pattern)
- One-off question without reusable insight`;

function buildUserPrompt(trajectory: string, response: string): string {
  return `Trajectory:
${trajectory.slice(0, 6000)}

Final assistant response:
${response.slice(0, 2000)}

Distill ONE reusable strategy. JSON only.`;
}

// Resolve the actual provider to use for distillation given a config preference.
// "auto" prefers anthropic (highest quality distillation) and falls back through
// openrouter → deepseek based on availability. Returns null if nothing usable.
export function resolveMiningProvider(pref: MiningProvider): "anthropic" | "openrouter" | "deepseek" | null {
  const av = getProviderAvailability();
  if (pref === "anthropic")  return av.anthropic  ? "anthropic"  : null;
  if (pref === "openrouter") return av.openrouter ? "openrouter" : null;
  if (pref === "deepseek")   return av.deepseek   ? "deepseek"   : null;
  // auto
  if (av.anthropic)  return "anthropic";
  if (av.openrouter) return "openrouter";
  if (av.deepseek)   return "deepseek";
  return null;
}

async function callAnthropic(model: string, userPrompt: string): Promise<string> {
  const cred = getOauthCredential();
  if (!cred) throw new Error("no anthropic credential");
  const r = await fetch(config.anthropicUrl + "/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type":      "application/json",
      "Authorization":     "Bearer " + cred.token,
      "anthropic-version": "2023-06-01",
      "anthropic-beta":    "oauth-2025-04-20",
    },
    body: JSON.stringify({ model, max_tokens: 1024, system: DISTILL_SYSTEM, messages: [{ role: "user", content: userPrompt }] }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw new Error(`Anthropic ${r.status}: ${(await r.text().catch(() => "")).slice(0, 200)}`);
  const d = await r.json() as any;
  return d?.content?.[0]?.text || "";
}

// DeepSeek + OpenRouter both expose Anthropic-compatible /v1/messages — same body shape.
async function callAnthropicCompatible(provider: "deepseek" | "openrouter", model: string, userPrompt: string): Promise<string> {
  const apiKey = provider === "deepseek"
    ? (settings["deepseek_api_key"] || config.deepseekApiKey)
    : (settings["openrouter_api_key"] || config.openrouterApiKey);
  const baseUrl = provider === "deepseek"
    ? (settings["deepseek_base_url"] || config.deepseekBaseUrl)
    : (settings["openrouter_base_url"] || config.openrouterBaseUrl);
  if (!apiKey) throw new Error(`no ${provider} api key`);
  const headers: Record<string, string> = {
    "Content-Type":      "application/json",
    "Authorization":     "Bearer " + apiKey,
    "anthropic-version": "2023-06-01",
  };
  if (provider === "openrouter") headers["HTTP-Referer"] = "https://claude-proxy.wibudev.com";
  const r = await fetch(baseUrl + "/v1/messages", {
    method: "POST", headers,
    body: JSON.stringify({ model, max_tokens: 1024, system: DISTILL_SYSTEM, messages: [{ role: "user", content: userPrompt }] }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw new Error(`${provider} ${r.status}: ${(await r.text().catch(() => "")).slice(0, 200)}`);
  const d = await r.json() as any;
  return d?.content?.[0]?.text || "";
}

// Per-provider sensible default models. miningModel from config is honored
// only when it matches the chosen provider's namespace (cheap heuristic).
function modelForProvider(provider: "anthropic" | "openrouter" | "deepseek", hint: string): string {
  if (provider === "anthropic") {
    return hint.startsWith("claude-") ? hint : "claude-haiku-4-5-20251001";
  }
  if (provider === "deepseek") {
    return hint.startsWith("deepseek") ? hint : (settings["deepseek_model"] || config.deepseekModel);
  }
  // openrouter
  return hint.includes("/") ? hint : (settings["openrouter_model"] || config.openrouterModel);
}

// Backwards-compat export — used by older callers + tests. Auto-resolves the
// provider; only fails if nothing is configured.
export async function callClaudeForDistillation(trajectory: string, response: string, model: string): Promise<string> {
  const provider = resolveMiningProvider("auto");
  if (!provider) throw new Error("no provider configured for mining — set up Claude, DeepSeek, or OpenRouter");
  const actualModel = modelForProvider(provider, model);
  const userPrompt = buildUserPrompt(trajectory, response);
  if (provider === "anthropic") return callAnthropic(actualModel, userPrompt);
  return callAnthropicCompatible(provider, actualModel, userPrompt);
}

export async function callForDistillation(trajectory: string, response: string, pref: MiningProvider, modelHint: string): Promise<string> {
  const provider = resolveMiningProvider(pref);
  if (!provider) {
    // Silent skip — caller treats empty string as "skipped". Avoid loud throws
    // that turn the worker queue into a retry loop when Anthropic is offline.
    if (!hasAnthropicCredential()) {
      throw new Error(`mining skipped: provider '${pref}' not available and no fallback configured`);
    }
    throw new Error(`mining provider '${pref}' not configured`);
  }
  const actualModel = modelForProvider(provider, modelHint);
  const userPrompt = buildUserPrompt(trajectory, response);
  if (provider === "anthropic") return callAnthropic(actualModel, userPrompt);
  return callAnthropicCompatible(provider, actualModel, userPrompt);
}

export function parseDistillation(text: string): DistillResult | null {
  if (!text) return null;
  let cleaned = text.trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "");
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed?.skip === true) {
      return { skip: true, reason: String(parsed.reason || "no reason").slice(0, 200) };
    }
    if (!parsed?.title || typeof parsed.title !== "string") return null;
    return {
      title:        String(parsed.title).slice(0, 80),
      when_to_use:  String(parsed.when_to_use || "").slice(0, 200),
      key_steps:    Array.isArray(parsed.key_steps) ? parsed.key_steps.slice(0, 5).map((s: any) => String(s).slice(0, 120)) : [],
      pitfalls:     Array.isArray(parsed.pitfalls)  ? parsed.pitfalls.slice(0, 3).map((s: any) => String(s).slice(0, 120)) : [],
      tags:         Array.isArray(parsed.tags)      ? parsed.tags.slice(0, 4).map((s: any) => String(s).toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 24)).filter(Boolean) : [],
    };
  } catch {
    return null;
  }
}

export async function distillStrategy(trajectory: string, response: string, model: string, pref: MiningProvider = "auto"): Promise<DistillResult | null> {
  const raw = await callForDistillation(trajectory, response, pref, model);
  return parseDistillation(raw);
}
