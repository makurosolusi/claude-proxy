import { config } from "./config";
import { tokens, dailyUsage, settings, dbInsertEnvToken, dbUpdateUsage, dbUpsertDailyUsage, dbResetToken } from "./state";
import type { TokenEntry, ResetMode } from "./types";

// Single source of truth for the global quota reset policy. Applies to ALL
// tokens — there is no per-token override. Default "manual" so a fresh install
// behaves as a real budget (admin must reset or raise limit when capped).
export function getResetMode(): ResetMode {
  const v = settings["reset_mode"];
  if (v === "auto" || v === "daily") return v;
  return "manual";
}

export function initFromEnv() {
  const now = Date.now();
  const inserts: Promise<void>[] = [];
  for (const line of config.tokensEnv.trim().split("\n")) {
    const [key, limit, win] = line.trim().split(":");
    if (!key) continue;
    if (tokens[key]) continue;
    const entry: TokenEntry = {
      limit:        limit === "unlimited" ? Infinity : parseInt(limit),
      window:       parseInt(win || String(config.windowMs)),
      used:         0,
      windowStart:  now,
      paused:       false,
      dynamic:      false,
      mode:         "inherit",
      provider:     "inherit",
      user_id:      "",
      label:        "",
      description:  "",
      pinned_model: "",
      last_reset:   0,
    };
    tokens[key] = entry;
    inserts.push(dbInsertEnvToken(key, entry));
  }
  // fire-and-forget inserts — startup doesn't need to block on these
  Promise.all(inserts).catch(e => console.error("[tokens] initFromEnv insert error:", e));
  console.log("Tokens:", Object.keys(tokens));
}

function localDateKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

// Mode-aware reset check called before every request. Reads the GLOBAL setting
// — there is no per-token override.
// - manual: never auto-reset. Quota only changes via admin or natural usage.
// - auto:   rolling window (resets when window elapses).
// - daily:  reset once when local-time date crosses midnight.
export function checkReset(t: TokenEntry, key: string) {
  const mode = getResetMode();
  if (mode === "manual") return;

  const now = Date.now();
  let shouldReset = false;
  if (mode === "auto") {
    shouldReset = now - t.windowStart >= t.window;
  } else if (mode === "daily") {
    shouldReset = localDateKey(t.windowStart || 0) !== localDateKey(now);
  }
  if (!shouldReset) return;

  t.used = 0;
  t.windowStart = now;
  t.last_reset  = now;
  dbResetToken(key, now).catch(e => console.error("[tokens] checkReset error:", e));
}

export function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

export function addDailyUsage(key: string, delta: number) {
  if (delta <= 0) return;
  const d = todayKey();
  if (!dailyUsage[d]) dailyUsage[d] = {};
  dailyUsage[d][key] = (dailyUsage[d][key] || 0) + delta;
  dbUpsertDailyUsage(d, key, delta).catch(e => console.error("[tokens] addDailyUsage error:", e));
}

// ── Generation counter ────────────────────────────────────────────────────────
// Bumped on every admin reset — stale in-flight requests from before the reset
// carry the old generation and are silently dropped by incrementUsage.
const tokenGen = new Map<string, number>();

export function getGeneration(key: string): number {
  return tokenGen.get(key) ?? 0;
}

export function bumpGeneration(key: string) {
  tokenGen.set(key, (tokenGen.get(key) ?? 0) + 1);
}

export function incrementUsage(key: string, delta: number, gen?: number) {
  if (!tokens[key]) return;
  if (gen !== undefined && gen !== getGeneration(key)) return;
  tokens[key].used += delta;
  addDailyUsage(key, delta);
  dbUpdateUsage(key, tokens[key].used).catch(e => console.error("[tokens] incrementUsage error:", e));
}

// ── In-flight reservation system ──────────────────────────────────────────────
// Each request gets a unique reservation ID. Reservations auto-expire after
// TTL so leaked reservations (disconnect, exception) never block forever.
//
// Design:
//   reserveInFlight(key, amount) → id   (call once per request, before forward)
//   releaseInFlight(key, id)           (call in finally block, always)
//   getInFlight(key)                   (total reserved tokens for quota check)

interface Reservation {
  id:     number;
  amount: number;
  ts:     number;     // creation timestamp for TTL
}

const INFLIGHT_TTL_MS = 3 * 60 * 1000;  // 3 minutes safety net — streaming rarely >2min
const inFlightMap     = new Map<string, Reservation[]>();
let   _nextId         = 0;

function cleanStale(key: string) {
  const now     = Date.now();
  const entries = inFlightMap.get(key);
  if (!entries?.length) { inFlightMap.delete(key); return; }
  const fresh   = entries.filter(e => now - e.ts < INFLIGHT_TTL_MS);
  const dropped = entries.length - fresh.length;
  if (dropped > 0) {
    const tokens = entries.filter(e => now - e.ts >= INFLIGHT_TTL_MS).reduce((s, e) => s + e.amount, 0);
    console.warn(`[tokens] ${key.slice(-6)}: ${dropped} stale reservation(s) expired (${tokens} tokens freed by TTL)`);
  }
  if (fresh.length === 0) inFlightMap.delete(key);
  else                    inFlightMap.set(key, fresh);
}

export function getInFlight(key: string): number {
  cleanStale(key);
  return (inFlightMap.get(key) ?? []).reduce((s, e) => s + e.amount, 0);
}

export function reserveInFlight(key: string, amount: number): number {
  cleanStale(key);
  const id      = ++_nextId;
  const entries = inFlightMap.get(key) ?? [];
  entries.push({ id, amount, ts: Date.now() });
  inFlightMap.set(key, entries);
  return id;
}

export function releaseInFlight(key: string, id: number) {
  const entries = inFlightMap.get(key);
  if (!entries) return;
  const fresh = entries.filter(e => e.id !== id);
  if (fresh.length === 0) inFlightMap.delete(key);
  else                    inFlightMap.set(key, fresh);
}

export function clearInFlight(key?: string) {
  if (key) inFlightMap.delete(key);
  else     inFlightMap.clear();
}

// ── Display helpers ───────────────────────────────────────────────────────────
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
