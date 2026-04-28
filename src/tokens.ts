import { config } from "./config";
import { tokens, dailyUsage, dbInsertEnvToken, dbUpdateUsage, dbUpsertDailyUsage, dbResetToken } from "./state";
import type { TokenEntry } from "./types";

export function initFromEnv() {
  const now = Date.now();
  for (const line of config.tokensEnv.trim().split("\n")) {
    const [key, limit, win] = line.trim().split(":");
    if (!key) continue;
    if (tokens[key]) continue; // already loaded from DB
    const entry: TokenEntry = {
      limit:       limit === "unlimited" ? Infinity : parseInt(limit),
      window:      parseInt(win || String(config.windowMs)),
      used:        0,
      windowStart: now,
      paused:      false,
      dynamic:     false,
      mode:        "inherit",
    };
    tokens[key] = entry;
    dbInsertEnvToken(key, entry);
  }
  console.log("Tokens:", Object.keys(tokens));
}

export function checkReset(t: TokenEntry, key: string) {
  if (Date.now() - t.windowStart >= t.window) {
    const now = Date.now();
    t.used = 0;
    t.windowStart = now;
    dbResetToken(key, now);
  }
}

export function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

export function addDailyUsage(key: string, delta: number) {
  if (delta <= 0) return;
  const d = todayKey();
  if (!dailyUsage[d]) dailyUsage[d] = {};
  dailyUsage[d][key] = (dailyUsage[d][key] || 0) + delta;
  dbUpsertDailyUsage(d, key, delta);
}

export function incrementUsage(key: string, delta: number) {
  if (!tokens[key]) return;
  tokens[key].used += delta;
  addDailyUsage(key, delta);
  dbUpdateUsage(key, tokens[key].used);
}

export function maskToken(k: string) {
  const p = "sk-user-";
  if (k.startsWith(p) && k.length > p.length) return k.slice(p.length);
  return k.length <= 8 ? "***" : k.slice(0, 4) + "***" + k.slice(-4);
}

export function usageCls(pct: number) {
  if (pct > 100) return "over";
  if (pct >= 80)  return "high";
  if (pct >= 60)  return "warn";
  return "ok";
}
