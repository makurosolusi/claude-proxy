import { config } from "../config";
import { settings } from "../state";
import { getOauthCredential } from "../upstream";

type Provider = "anthropic" | "deepseek" | "openrouter";

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

const fetchers: Record<Provider, () => Promise<ModelEntry[]>> = {
  anthropic:  fetchAnthropicModels,
  deepseek:   fetchDeepSeekModels,
  openrouter: fetchOpenRouterModels,
};

export async function handleApiModels(req: Request, url: URL): Promise<Response> {
  const m = url.pathname.match(/^\/api\/admin\/models\/(anthropic|deepseek|openrouter)$/);
  if (!m) return Response.json({ error: "Not found" }, { status: 404 });
  const provider = m[1] as Provider;
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

  try {
    const models = await fetchers[provider]();
    cache[provider] = { models, fetchedAt: now };
    return Response.json({
      provider, models,
      fetched_at: now,
      cached: false,
      age_seconds: 0,
    });
  } catch (e: any) {
    // Serve stale cache if available, mark with error
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
