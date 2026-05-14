import { settings, dbSaveSetting } from "./state";

export type CustomProviderType = "anthropic" | "openai";

export interface CustomProvider {
  id:             string;           // slug, kebab-case (e.g. "groq")
  name:           string;           // display name
  type:           CustomProviderType;
  base_url:       string;
  api_key:        string;
  color?:         string;           // optional mantine color name
}

const SETTING_KEY = "custom_providers";

const RESERVED_IDS = new Set(["inherit", "anthropic", "deepseek", "openrouter", "auto", ""]);
const ID_PATTERN   = /^[a-z][a-z0-9-]{1,30}$/;

export function getCustomProviders(): CustomProvider[] {
  try {
    const raw = settings[SETTING_KEY];
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(isValidProvider);
  } catch { return []; }
}

export function getCustomProvider(id: string): CustomProvider | null {
  return getCustomProviders().find(p => p.id === id) || null;
}

export function isCustomProviderId(id: string): boolean {
  return !RESERVED_IDS.has(id) && getCustomProvider(id) !== null;
}

function isValidProvider(p: any): p is CustomProvider {
  return p
    && typeof p.id === "string"
    && typeof p.name === "string"
    && typeof p.type === "string"
    && (p.type === "anthropic" || p.type === "openai")
    && typeof p.base_url === "string"
    && typeof p.api_key === "string";
}

export function validateNewProvider(p: any, existingIds: string[]): string | null {
  if (!p || typeof p !== "object") return "Body must be an object";
  if (typeof p.id !== "string" || !ID_PATTERN.test(p.id)) {
    return "id must be kebab-case slug (2-31 chars, [a-z0-9-], starts with letter)";
  }
  if (RESERVED_IDS.has(p.id)) return `id "${p.id}" is reserved`;
  if (existingIds.includes(p.id)) return `id "${p.id}" already exists`;
  if (typeof p.name !== "string" || !p.name.trim()) return "name is required";
  if (p.type !== "anthropic" && p.type !== "openai") return 'type must be "anthropic" or "openai"';
  if (typeof p.base_url !== "string" || !/^https?:\/\//.test(p.base_url)) return "base_url must start with http:// or https://";
  if (typeof p.api_key !== "string" || !p.api_key.trim()) return "api_key is required";
  return null;
}

export async function saveCustomProviders(list: CustomProvider[]): Promise<void> {
  await dbSaveSetting(SETTING_KEY, JSON.stringify(list));
}

export async function upsertCustomProvider(p: CustomProvider): Promise<void> {
  const list = getCustomProviders();
  const idx  = list.findIndex(x => x.id === p.id);
  if (idx >= 0) list[idx] = p; else list.push(p);
  await saveCustomProviders(list);
}

export async function deleteCustomProvider(id: string): Promise<void> {
  const list = getCustomProviders().filter(x => x.id !== id);
  await saveCustomProviders(list);
}
