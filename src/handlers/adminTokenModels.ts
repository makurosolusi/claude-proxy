import { tokens, settings, dbUpdateAllowedModels } from "../state";
import { normalizeAllowed, derivePinnedModel, swapModel } from "../modelAllowlist";
import { getCustomProvider } from "../customProviders";
import { triggerBroadcast } from "../broadcast";
import { config } from "../config";

async function write(key: string, allowed: string[]): Promise<void> {
  tokens[key]!.allowed_models = allowed;
  tokens[key]!.pinned_model   = derivePinnedModel(allowed);
  await dbUpdateAllowedModels(key, allowed);
}

// providerScope semantics — uses EFFECTIVE routing (matches what proxy.ts does at runtime).
//  - ""           = all tokens (no scope filter)
//  - "anthropic" / "deepseek" / "openrouter" / custom slug = tokens that effectively route there
function makeInScope(providerScope: string): (tokenProvider: string) => boolean {
  const globalOverride = settings["provider_override"] || "";
  const deepseekConfigured   = !!(settings["deepseek_api_key"]   || config.deepseekApiKey);
  const openrouterConfigured = !!(settings["openrouter_api_key"] || config.openrouterApiKey);
  const isConfigured = (id: string): boolean => {
    if (id === "anthropic" || id === "" || id === "inherit") return true;
    if (id === "deepseek")   return deepseekConfigured;
    if (id === "openrouter") return openrouterConfigured;
    const cp = getCustomProvider(id);
    return !!(cp && cp.api_key);
  };
  const effectiveProviderOf = (tokenProvider: string): string => {
    if (tokenProvider && tokenProvider !== "inherit") {
      return isConfigured(tokenProvider) ? tokenProvider : "anthropic";
    }
    if (globalOverride) {
      return isConfigured(globalOverride) ? globalOverride : "anthropic";
    }
    return "anthropic";
  };
  return (tokenProvider: string) => {
    if (!providerScope) return true;
    return effectiveProviderOf(tokenProvider) === providerScope;
  };
}

export async function handleTokenAllowedModels(
  pathname: string, req: Request, form: FormData | null,
): Promise<Response | null> {
  if (req.method !== "POST") return null;

  if (pathname === "/admin/token/allowed-models") {
    const target = String(form?.get("token") || "").trim();
    if (!target || !tokens[target]) return new Response("Token not found\n", { status: 404 });
    const allowed = normalizeAllowed(String(form?.get("models") || ""));
    await write(target, allowed);
    triggerBroadcast();
    return Response.json({ ok: true, allowed_models: allowed });
  }

  if (pathname === "/admin/token/pin-model") {
    const target = String(form?.get("token") || "").trim();
    const model  = String(form?.get("model") || "").trim();
    if (!target || !tokens[target]) return new Response("Token not found\n", { status: 404 });
    await write(target, model ? [model] : []);
    triggerBroadcast();
    return Response.json({ ok: true });
  }

  if (pathname === "/admin/token/pin-all") {
    const model         = String(form?.get("model")          || "").trim();
    const userId        = String(form?.get("user_id")        || "").trim();
    const providerScope = String(form?.get("provider_scope") || "").trim();
    const inScope = makeInScope(providerScope);
    const allowed = model ? [model] : [];
    let pinnedCount = 0;
    for (const [k, tk] of Object.entries(tokens)) {
      if (userId && tk.user_id !== userId) continue;
      if (!inScope(tk.provider || "inherit")) continue;
      await write(k, allowed);
      pinnedCount++;
    }
    triggerBroadcast();
    return Response.json({ ok: true, count: pinnedCount });
  }

  if (pathname === "/admin/token/swap-model") {
    const from = String(form?.get("from") || "").trim();
    if (!from) return new Response("Field 'from' is required\n", { status: 400 });
    const to            = String(form?.get("to")             || "").trim();
    const userId        = String(form?.get("user_id")        || "").trim();
    const inScope       = makeInScope(String(form?.get("provider_scope") || "").trim());
    const unrestricted  = ["1", "true"].includes(String(form?.get("include_unrestricted") || "").trim());

    let count = 0;
    for (const [k, tk] of Object.entries(tokens)) {
      if (userId && tk.user_id !== userId) continue;
      if (!inScope(tk.provider || "inherit")) continue;
      const current = tk.allowed_models || [];
      if (current.length === 0) {
        if (!unrestricted || !to) continue;
        await write(k, [to]);
        count++;
        continue;
      }
      const next = swapModel(current, from, to);
      if (next.length === current.length && next.every((m, i) => m === current[i])) continue;
      await write(k, next);
      count++;
    }
    triggerBroadcast();
    return Response.json({ ok: true, count });
  }

  return null;
}
