import { config } from "./config";
import { settings } from "./state";
import { hasAnthropicCredential } from "./upstream";
import { getCustomProvider, getCustomProviders } from "./customProviders";

export interface ProviderAvailability {
  anthropic:  boolean;
  deepseek:   boolean;
  openrouter: boolean;
  customIds:  string[]; // custom providers with api_key set
}

export function getProviderAvailability(): ProviderAvailability {
  return {
    anthropic:  hasAnthropicCredential(),
    deepseek:   !!(settings["deepseek_api_key"]   || config.deepseekApiKey),
    openrouter: !!(settings["openrouter_api_key"] || config.openrouterApiKey),
    customIds:  getCustomProviders().filter(p => !!p.api_key).map(p => p.id),
  };
}

export function isProviderConfigured(id: string): boolean {
  if (!id || id === "inherit" || id === "") return false;
  const av = getProviderAvailability();
  if (id === "anthropic")  return av.anthropic;
  if (id === "deepseek")   return av.deepseek;
  if (id === "openrouter") return av.openrouter;
  return av.customIds.includes(id);
}

// The single source of truth for "what provider should we use when nothing is
// explicitly chosen?". Used by proxy.ts (auto routing), apiStatus.ts (UI
// display), and boot logging. Order:
//   1. anthropic — if a Claude credential exists (back-compat default)
//   2. openrouter — first cheaper/faster fallback
//   3. deepseek
//   4. first custom provider with api_key
//   5. "" — no provider configured at all
export function pickDefaultProvider(): string {
  const av = getProviderAvailability();
  if (av.anthropic)  return "anthropic";
  if (av.openrouter) return "openrouter";
  if (av.deepseek)   return "deepseek";
  if (av.customIds[0]) return av.customIds[0];
  return "";
}

// Operation mode for boot log + admin banner.
export type OperationMode =
  | "anthropic-primary"  // Anthropic + (maybe) fallback configured
  | "fallback-only"      // No Anthropic, but at least one other provider configured
  | "no-provider";       // Nothing configured — every request will 503

export function getOperationMode(): OperationMode {
  const av = getProviderAvailability();
  if (av.anthropic) return "anthropic-primary";
  if (av.openrouter || av.deepseek || av.customIds.length > 0) return "fallback-only";
  return "no-provider";
}
