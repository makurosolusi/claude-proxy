// Shared helpers for displaying provider/model info in user-facing components.
// Used by Dashboard, ProfilePage, UserCard, etc.

export interface ProviderInfo { id: string; name: string; color: string; }

export const BUILTIN_PROVIDER_MAP: Record<string, ProviderInfo> = {
  inherit:    { id: "inherit",    name: "Auto",       color: "gray"   },
  anthropic:  { id: "anthropic",  name: "Claude Max", color: "blue"   },
  deepseek:   { id: "deepseek",   name: "DeepSeek",   color: "violet" },
  openrouter: { id: "openrouter", name: "OpenRouter", color: "orange" },
};

// Resolve provider id to display info. Falls back to id with gray for unknown (orphan) providers.
export function resolveProvider(id: string, customProviders: ProviderInfo[] = []): ProviderInfo {
  if (BUILTIN_PROVIDER_MAP[id]) return BUILTIN_PROVIDER_MAP[id];
  const found = customProviders.find(p => p.id === id);
  if (found) return found;
  return { id, name: id || "Unknown", color: "gray" };
}

// Smart model-name shortening for display badges. Works for any provider style.
// - "anthropic/claude-3.5-sonnet" → "claude-3.5-sonnet" (strip vendor prefix)
// - "claude-sonnet-4-6"           → "claude-sonnet-4-6"
// - "claude-haiku-4-5-20251001"   → "claude-haiku-4-5-…"
// - "llama-3.3-70b-versatile"     → "llama-3.3-70b-ver…"
export function shortenModel(m: string, maxLen: number = 24): string {
  if (!m) return "";
  const stripped = m.includes("/") ? (m.split("/").pop() || m) : m;
  if (stripped.length <= maxLen) return stripped;
  return stripped.slice(0, maxLen - 1) + "…";
}
