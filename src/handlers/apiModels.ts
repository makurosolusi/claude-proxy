import { config } from "../config";
import { settings } from "../state";
import { getOauthCredential, hasAnthropicCredential } from "../upstream";
import { getCustomProvider } from "../customProviders";

type Provider = string; // built-in or custom slug

interface ModelEntry {
  id:           string;
  display_name: string;
}

interface CacheEntry {
  models:    ModelEntry[];
  fetchedAt: number;
  error?:    string;
}

const TTL_MS = 30 * 60_000; // 30 minutes
const cache: Record<Provider, CacheEntry | null> = {
  anthropic:  null,
  deepseek:   null,
  openrouter: null,
};

async function fetchAnthropicModels(): Promise<ModelEntry[]> {
  const cred = getOauthCredential();
  if (!cred) throw new Error("No Claude credential configured");
  const r = await fetch(config.anthropicUrl + "/v1/models", {
    headers: {
      "Accept":            "application/json",
      "Authorization":     "Bearer " + cred.token,
      "anthropic-version": "2023-06-01",
      "anthropic-beta":    "oauth-2025-04-20",
    },
  });
  if (!r.ok) throw new Error(`Anthropic /v1/models HTTP ${r.status}`);
  const d = await r.json() as any;
  if (!Array.isArray(d?.data)) throw new Error("Anthropic /v1/models: unexpected response");
  return d.data.map((m: any) => ({
    id:           m.id,
    display_name: m.display_name || m.id,
  }));
}

async function fetchDeepSeekModels(): Promise<ModelEntry[]> {
  const apiKey  = settings["deepseek_api_key"] || config.deepseekApiKey;
  if (!apiKey) throw new Error("No DeepSeek API key configured");
  const baseUrl = settings["deepseek_base_url"] || config.deepseekBaseUrl;
  // DeepSeek's anthropic-compat baseUrl is e.g. "https://api.deepseek.com/anthropic"
  // The models endpoint is on the OpenAI-compat path "/v1/models". Try both.
  const candidates = [
    baseUrl.replace(/\/anthropic\/?$/, "") + "/v1/models",
    baseUrl + "/v1/models",
  ];
  let lastErr = "";
  for (const url of candidates) {
    try {
      const r = await fetch(url, {
        headers: { "Authorization": "Bearer " + apiKey, "Accept": "application/json" },
      });
      if (!r.ok) { lastErr = `${url} → HTTP ${r.status}`; continue; }
      const d = await r.json() as any;
      if (!Array.isArray(d?.data)) { lastErr = `${url} → bad shape`; continue; }
      return d.data.map((m: any) => ({
        id:           m.id,
        display_name: m.id,
      }));
    } catch (e: any) { lastErr = `${url} → ${e.message}`; }
  }
  throw new Error("DeepSeek /v1/models failed: " + lastErr);
}

async function fetchOpenRouterModels(): Promise<ModelEntry[]> {
  const apiKey  = settings["openrouter_api_key"] || config.openrouterApiKey;
  const baseUrl = settings["openrouter_base_url"] || config.openrouterBaseUrl;
  // OpenRouter is "https://openrouter.ai/api" — models at "/v1/models", public but ratelimited
  const url = baseUrl.replace(/\/$/, "") + "/v1/models";
  const headers: Record<string, string> = { "Accept": "application/json" };
  if (apiKey) headers["Authorization"] = "Bearer " + apiKey;
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`OpenRouter /v1/models HTTP ${r.status}`);
  const d = await r.json() as any;
  if (!Array.isArray(d?.data)) throw new Error("OpenRouter /v1/models: unexpected response");
  return d.data.map((m: any) => ({
    id:           m.id,
    display_name: m.name || m.id,
  }));
}

async function fetchCustomModels(id: string): Promise<ModelEntry[]> {
  const cp = getCustomProvider(id);
  if (!cp) throw new Error(`Custom provider "${id}" not found`);
  if (!cp.api_key) throw new Error(`Custom provider "${id}" has no API key`);

  // For both anthropic-like and openai-like, /v1/models is the standard endpoint
  const url = cp.base_url.replace(/\/$/, "") + "/v1/models";
  const headers: Record<string, string> = {
    "Authorization": "Bearer " + cp.api_key,
    "Accept":        "application/json",
  };
  // OpenRouter-like providers may want anthropic-version header; harmless to include
  if (cp.type === "anthropic") headers["anthropic-version"] = "2023-06-01";

  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`${cp.name} /v1/models HTTP ${r.status}`);
  const d = await r.json() as any;
  if (!Array.isArray(d?.data)) throw new Error(`${cp.name} /v1/models: unexpected response`);
  return d.data.map((m: any) => ({
    id:           m.id,
    display_name: m.display_name || m.name || m.id,
  }));
}

const builtinFetchers: Record<string, () => Promise<ModelEntry[]>> = {
  anthropic:  fetchAnthropicModels,
  deepseek:   fetchDeepSeekModels,
  openrouter: fetchOpenRouterModels,
};

function getFetcher(provider: string): () => Promise<ModelEntry[]> {
  if (provider in builtinFetchers) return builtinFetchers[provider]!;
  return () => fetchCustomModels(provider);
}

export async function handleApiModels(req: Request, url: URL): Promise<Response> {
  const m = url.pathname.match(/^\/api\/admin\/models\/([a-z][a-z0-9-]*)$/);
  if (!m) return Response.json({ error: "Not found" }, { status: 404 });
  const provider = m[1]!;

  // Validate provider exists (builtin or custom)
  if (!(provider in builtinFetchers) && !getCustomProvider(provider)) {
    return Response.json({ error: `Unknown provider "${provider}"` }, { status: 404 });
  }

  const force = url.searchParams.get("refresh") === "1";
  const now = Date.now();
  const c = cache[provider];
  if (!force && c && now - c.fetchedAt < TTL_MS && !c.error) {
    return Response.json({
      provider, models: c.models,
      fetched_at: c.fetchedAt,
      cached: true,
      age_seconds: Math.floor((now - c.fetchedAt) / 1000),
    });
  }

  // Graceful skip for Anthropic when no credential is connected — return 200
  // with empty list + helpful message instead of 502, so admin UI doesn't render
  // a scary error.
  if (provider === "anthropic" && !hasAnthropicCredential()) {
    return Response.json({
      provider, models: [],
      fetched_at: now,
      cached: false,
      age_seconds: 0,
      disabled: true,
      error: "No Claude credential connected — Anthropic is disabled. Add a credential in admin → Accounts or set provider_override to deepseek/openrouter.",
    });
  }

  try {
    const models = await getFetcher(provider)();
    cache[provider] = { models, fetchedAt: now };
    return Response.json({
      provider, models,
      fetched_at: now,
      cached: false,
      age_seconds: 0,
    });
  } catch (e: any) {
    if (c) {
      return Response.json({
        provider, models: c.models,
        fetched_at: c.fetchedAt,
        cached: true,
        stale: true,
        error: e.message,
        age_seconds: Math.floor((now - c.fetchedAt) / 1000),
      });
    }
    return Response.json({ provider, models: [], error: e.message }, { status: 502 });
  }
}
