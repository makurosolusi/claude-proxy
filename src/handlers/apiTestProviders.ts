import { config } from "../config";
import { settings } from "../state";

export async function handleDeepSeekTest(): Promise<Response> {
  const apiKey = settings["deepseek_api_key"] || config.deepseekApiKey;
  if (!apiKey) return Response.json({ ok: false, error: "No DeepSeek API key configured" });
  const baseUrl = settings["deepseek_base_url"] || config.deepseekBaseUrl;
  const t0 = Date.now();
  try {
    const r = await fetch(baseUrl + "/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: settings["deepseek_model"] || config.deepseekModel,
        max_tokens: 12,
        messages: [{ role: "user", content: "Reply with exactly the word: OK" }],
      }),
      signal: AbortSignal.timeout(10000),
    });
    const lat = Date.now() - t0;
    if (r.ok) {
      const d = await r.json() as any;
      const text = d?.content?.[0]?.text ?? "";
      const toks = (d?.usage?.input_tokens ?? 0) + (d?.usage?.output_tokens ?? 0);
      return Response.json({ ok: true, latency: lat, detail: `"${text.slice(0, 40)}" · ${toks} tokens` });
    }
    const d = await r.json().catch(() => ({})) as any;
    return Response.json({ ok: false, latency: lat, error: d?.error?.message ?? `HTTP ${r.status}` });
  } catch (e: any) {
    return Response.json({ ok: false, latency: Date.now() - t0, error: e.message });
  }
}

async function fetchFirstModel(baseUrl: string, apiKey: string, type: "anthropic" | "openai"): Promise<string | null> {
  try {
    const url = baseUrl.replace(/\/$/, "") + "/v1/models";
    const headers: Record<string, string> = {
      "Authorization": "Bearer " + apiKey,
      "Accept":        "application/json",
    };
    if (type === "anthropic") headers["anthropic-version"] = "2023-06-01";
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const d = await r.json() as any;
    const first = Array.isArray(d?.data) && d.data.length > 0 ? d.data[0] : null;
    return first?.id ?? null;
  } catch { return null; }
}

export async function handleCustomProviderTest(id: string): Promise<Response> {
  const { getCustomProvider } = await import("../customProviders");
  const cp = getCustomProvider(id);
  if (!cp) return Response.json({ ok: false, error: `Custom provider "${id}" not found` });
  if (!cp.api_key) return Response.json({ ok: false, error: "No API key configured" });

  const testModel = await fetchFirstModel(cp.base_url, cp.api_key, cp.type);
  if (!testModel) {
    return Response.json({ ok: false, error: "Failed to fetch models from /v1/models — cannot run test" });
  }

  const t0 = Date.now();
  try {
    if (cp.type === "openai") {
      const r = await fetch(cp.base_url + "/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": "Bearer " + cp.api_key,
        },
        body: JSON.stringify({
          model: testModel,
          messages: [{ role: "user", content: "Reply with exactly the word: OK" }],
          max_tokens: 12,
        }),
        signal: AbortSignal.timeout(15000),
      });
      const lat = Date.now() - t0;
      if (r.ok) {
        const d = await r.json() as any;
        const text = d?.choices?.[0]?.message?.content ?? "";
        const toks = (d?.usage?.prompt_tokens ?? 0) + (d?.usage?.completion_tokens ?? 0);
        return Response.json({ ok: true, latency: lat, detail: `"${text.slice(0, 40)}" · ${toks} tokens · model: ${testModel} (openai)` });
      }
      const d = await r.json().catch(() => ({})) as any;
      return Response.json({ ok: false, latency: lat, error: d?.error?.message ?? `HTTP ${r.status}` });
    }
    const r = await fetch(cp.base_url + "/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type":      "application/json",
        "Authorization":     "Bearer " + cp.api_key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: testModel,
        max_tokens: 12,
        messages: [{ role: "user", content: "Reply with exactly the word: OK" }],
      }),
      signal: AbortSignal.timeout(15000),
    });
    const lat = Date.now() - t0;
    if (r.ok) {
      const d = await r.json() as any;
      const text = d?.content?.[0]?.text ?? "";
      const toks = (d?.usage?.input_tokens ?? 0) + (d?.usage?.output_tokens ?? 0);
      return Response.json({ ok: true, latency: lat, detail: `"${text.slice(0, 40)}" · ${toks} tokens · model: ${testModel} (anthropic)` });
    }
    const d = await r.json().catch(() => ({})) as any;
    return Response.json({ ok: false, latency: lat, error: d?.error?.message ?? `HTTP ${r.status}` });
  } catch (e: any) {
    return Response.json({ ok: false, latency: Date.now() - t0, error: e.message });
  }
}

export async function handleOpenRouterTest(): Promise<Response> {
  const apiKey = settings["openrouter_api_key"] || config.openrouterApiKey;
  if (!apiKey) return Response.json({ ok: false, error: "No OpenRouter API key configured" });
  const baseUrl = settings["openrouter_base_url"] || config.openrouterBaseUrl;
  const t0 = Date.now();
  try {
    const r = await fetch(baseUrl + "/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + apiKey,
        "anthropic-version": "2023-06-01",
        "HTTP-Referer": "https://claude-proxy.wibudev.com",
      },
      body: JSON.stringify({
        model: settings["openrouter_model"] || config.openrouterModel,
        max_tokens: 12,
        messages: [{ role: "user", content: "Reply with exactly the word: OK" }],
      }),
      signal: AbortSignal.timeout(10000),
    });
    const lat = Date.now() - t0;
    if (r.ok) {
      const d = await r.json() as any;
      const text = d?.content?.[0]?.text ?? "";
      const toks = (d?.usage?.input_tokens ?? 0) + (d?.usage?.output_tokens ?? 0);
      return Response.json({ ok: true, latency: lat, detail: `"${text.slice(0, 40)}" · ${toks} tokens` });
    }
    const d = await r.json().catch(() => ({})) as any;
    return Response.json({ ok: false, latency: lat, error: d?.error?.message ?? `HTTP ${r.status}` });
  } catch (e: any) {
    return Response.json({ ok: false, latency: Date.now() - t0, error: e.message });
  }
}
