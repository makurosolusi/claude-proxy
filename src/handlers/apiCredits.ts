import { config } from "../config";
import { settings } from "../state";

// Normalized credit info shape — frontend doesn't need to know provider quirks.
export interface CreditInfo {
  provider:   string;
  currency:   string;
  total:      number | null;   // total provisioned (granted + topped-up for DS, limit for OR)
  used:       number | null;   // accumulated usage (OR only — DS doesn't expose this)
  remaining:  number;          // sisa kredit yang bisa dipakai
  granted:    number | null;   // free credit (DS specific)
  topped_up:  number | null;   // deposited credit (DS specific)
  raw?:       any;             // raw response for debugging
}

async function fetchDeepSeekBalance(apiKey: string): Promise<CreditInfo> {
  // DS balance endpoint is on the bare /user/balance path — NOT under /anthropic
  // baseUrl env may include /anthropic suffix; strip it.
  const baseUrl = (settings["deepseek_base_url"] || config.deepseekBaseUrl).replace(/\/anthropic\/?$/, "");
  const r = await fetch(baseUrl.replace(/\/$/, "") + "/user/balance", {
    headers: { "Authorization": "Bearer " + apiKey, "Accept": "application/json" },
  });
  if (!r.ok) throw new Error(`DeepSeek /user/balance HTTP ${r.status}`);
  const d = await r.json() as any;
  const info = d?.balance_infos?.[0];
  if (!info) throw new Error("DeepSeek /user/balance: unexpected response");
  const total     = parseFloat(info.total_balance      || "0");
  const granted   = parseFloat(info.granted_balance    || "0");
  const toppedUp  = parseFloat(info.topped_up_balance  || "0");
  return {
    provider:  "deepseek",
    currency:  info.currency || "USD",
    total:     granted + toppedUp,
    used:      null, // DS doesn't expose cumulative usage
    remaining: total,
    granted,
    topped_up: toppedUp,
    raw:       d,
  };
}

async function fetchOpenRouterBalance(apiKey: string): Promise<CreditInfo> {
  const baseUrl = settings["openrouter_base_url"] || config.openrouterBaseUrl;
  const r = await fetch(baseUrl.replace(/\/$/, "") + "/v1/credits", {
    headers: { "Authorization": "Bearer " + apiKey, "Accept": "application/json" },
  });
  if (!r.ok) throw new Error(`OpenRouter /v1/credits HTTP ${r.status}`);
  const d = await r.json() as any;
  const totalCredits = parseFloat(d?.data?.total_credits ?? "0");
  const totalUsage   = parseFloat(d?.data?.total_usage   ?? "0");
  return {
    provider:  "openrouter",
    currency:  "USD",
    total:     totalCredits,
    used:      totalUsage,
    remaining: Math.max(0, totalCredits - totalUsage),
    granted:   null,
    topped_up: null,
    raw:       d,
  };
}

// GET /api/admin/credits/:provider
export async function handleApiCredits(req: Request, url: URL): Promise<Response> {
  const m = url.pathname.match(/^\/api\/admin\/credits\/([a-z][a-z0-9-]*)$/);
  if (!m) return Response.json({ error: "Not found" }, { status: 404 });
  const provider = m[1]!;

  try {
    if (provider === "deepseek") {
      const apiKey = settings["deepseek_api_key"] || config.deepseekApiKey;
      if (!apiKey) return Response.json({ error: "DeepSeek API key not configured" }, { status: 503 });
      return Response.json(await fetchDeepSeekBalance(apiKey));
    }
    if (provider === "openrouter") {
      const apiKey = settings["openrouter_api_key"] || config.openrouterApiKey;
      if (!apiKey) return Response.json({ error: "OpenRouter API key not configured" }, { status: 503 });
      return Response.json(await fetchOpenRouterBalance(apiKey));
    }
    return Response.json({ error: `Balance check not supported for "${provider}"` }, { status: 400 });
  } catch (e: any) {
    return Response.json({ error: e.message || "Failed to fetch balance" }, { status: 502 });
  }
}
