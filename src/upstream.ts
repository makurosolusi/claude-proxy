import fs from "fs";
import { config } from "./config";
import { upstream, tokens, dbSaveUpstream, dbResetAllTokens, dbAlignAllTokens, settings } from "./state";
import { triggerBroadcast, broadcastSystemMsg } from "./broadcast";
import { listCredentials, pickCredential, type OauthCredential } from "./anthropicAccounts";

const TOKEN_CACHE_MS    = 30_000;
const OAUTH_CLIENT_ID   = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const OAUTH_REFRESH_URL = "https://api.anthropic.com/v1/oauth/token";

// Refresh tokens are single-use, so concurrent refreshes of the SAME file must
// share one call. Keyed per file: two accounts refresh independently.
const refreshInFlight = new Map<string, Promise<string | null>>();
let lastPinWarnAt      = 0; // throttle the "pinned account unavailable" warning
let lastUtilAlertPct   = 0; // track last 5h utilization threshold that triggered a system message
let lastSonnetAlertPct = 0; // track last sonnet 7d threshold
let lastOpusAlertPct   = 0; // track last opus 7d threshold
let consecutiveNoCred  = 0; // count consecutive polls with missing credential
let lastNoCredLog      = 0; // throttle the no-credential warning log

// Cheap probe — does *any* usable claude-*.json exist? Cached for 30s with the
// same TTL as getOauthCredential. Side-effect free: never writes upstream.lastError.
// Honors settings.simulate_anthropic_disabled to let admins dry-run the
// fallback-only flow without touching credential files.
let hasAnthrCache: { value: boolean; at: number } = { value: false, at: 0 };
const HAS_ANTHR_TTL = 30_000;
export function hasAnthropicCredential(): boolean {
  if (settings["simulate_anthropic_disabled"] === "true") return false;
  const now = Date.now();
  if (now - hasAnthrCache.at < HAS_ANTHR_TTL) return hasAnthrCache.value;
  const value = listCredentials(config.authDir).some(r => r.usable);
  hasAnthrCache = { value, at: now };
  return value;
}

// Both credential caches must be dropped together: busting only tokenCache
// leaves hasAnthropicCredential() reporting stale availability for up to 30s.
export function bustCredentialCaches() {
  upstream.tokenCache = { value: null, readAt: 0, email: null };
  hasAnthrCache       = { value: false, at: 0 };
}

export function getOauthCredential(): OauthCredential | null {
  const now = Date.now();
  if (upstream.tokenCache.value && now - upstream.tokenCache.readAt < TOKEN_CACHE_MS) {
    return upstream.tokenCache.credential ?? null;
  }

  const { cred, error, warning } = pickCredential(config.authDir, settings["anthropic_account"] || "");

  if (warning && now - lastPinWarnAt > 60_000) {
    console.warn(`[upstream] ${warning}`);
    lastPinWarnAt = now;
  }
  if (!cred) {
    upstream.lastError = error;
    return null;
  }

  upstream.tokenCache = { value: cred.token, readAt: now, email: cred.email, credential: cred };
  return cred;
}

export function refreshOauthToken(filePath: string, refreshToken: string): Promise<string | null> {
  const inFlight = refreshInFlight.get(filePath);
  if (inFlight) return inFlight;
  const p = doRefresh(filePath, refreshToken).finally(() => refreshInFlight.delete(filePath));
  refreshInFlight.set(filePath, p);
  return p;
}

async function doRefresh(filePath: string, refreshToken: string): Promise<string | null> {
  try {
    console.log("[upstream] Refreshing OAuth token...");
    const resp = await fetch(OAUTH_REFRESH_URL, {
      method:  "POST",
      headers: {
        "Content-Type":    "application/json",
        "Accept":          "application/json",
        "Origin":          "https://claude.ai",
        "Referer":         "https://claude.ai/",
        "User-Agent":      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      },
      body: JSON.stringify({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: OAUTH_CLIENT_ID }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      upstream.lastError = `Token refresh HTTP ${resp.status}: ${body.slice(0, 120)}`;
      console.error("[upstream] Token refresh failed:", upstream.lastError);
      return null;
    }

    const data = await resp.json() as any;
    const newAccess  = data.access_token  as string;
    const newRefresh = data.refresh_token as string;   // MUST update — old refresh is now invalid

    // Read existing file to preserve other fields, then write updated tokens
    const existing = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    existing.access_token  = newAccess;
    existing.refresh_token = newRefresh;
    existing.last_refresh  = new Date().toISOString();
    existing.expired       = false;
    fs.writeFileSync(filePath, JSON.stringify(existing, null, 2), "utf-8");

    // Update in-memory cache immediately
    const cred: OauthCredential = {
      token: newAccess, filePath, refreshToken: newRefresh, email: existing.email || filePath,
    };
    // Only the account currently being served owns the cache slot — refreshing a
    // non-active account must not hijack it.
    if (!upstream.tokenCache.credential || upstream.tokenCache.credential.filePath === filePath) {
      upstream.tokenCache = { value: newAccess, readAt: Date.now(), email: cred.email, credential: cred };
    }
    console.log(`[upstream] Token refreshed for ${cred.email}, expires in ${data.expires_in ?? "?"}s`);
    return newAccess;
  } catch (e: any) {
    upstream.lastError = "Token refresh error: " + e.message;
    console.error("[upstream] Token refresh error:", e.message);
    return null;
  }
}

export async function poll() {
  const now = Date.now();
  if (upstream.pollBackoffUntil > now) {
    const rem = Math.ceil((upstream.pollBackoffUntil - now) / 1000);
    console.log(`[upstream] Poll skipped, backoff ${rem}s remaining`);
    return;
  }

  let cred = getOauthCredential();
  if (!cred) {
    upstream.lastPollOk = false;
    consecutiveNoCred++;
    // After 3 consecutive misses, throttle: only log once per 10 minutes and
    // back off the poller for 10 minutes. Anthropic is effectively disabled.
    if (consecutiveNoCred >= 3) {
      const TEN_MIN = 10 * 60_000;
      if (Date.now() - lastNoCredLog > TEN_MIN) {
        console.log(`[upstream] No Anthropic credential — poll throttled to 10m (set provider_override to bypass).`);
        lastNoCredLog = Date.now();
      }
      upstream.pollBackoffUntil = Date.now() + TEN_MIN;
    }
    return;
  }
  consecutiveNoCred = 0;

  try {
    const resp = await fetch("https://api.anthropic.com/api/oauth/usage", {
      headers: {
        "Authorization":  "Bearer " + cred.token,
        "anthropic-beta": "oauth-2025-04-20",
        "Accept":         "application/json",
        "User-Agent":     "claude-proxy/2.0",
      },
    });

    if (!resp.ok) {
      upstream.lastPollOk = false;
      if (resp.status === 429) {
        const ra  = resp.headers.get("retry-after");
        const sec = ra ? parseInt(ra) : NaN;
        const ms  = Math.max(!isNaN(sec) && sec > 0 ? sec * 1000 : 0, 5 * 60_000);
        upstream.pollBackoffUntil = Date.now() + ms;
        upstream.lastError = `Poll HTTP 429 · backoff ${Math.round(ms / 60000)}m`;
        console.log(`[upstream] 429, backoff ${Math.round(ms / 60000)}m`);
      } else if (resp.status === 401) {
        // Token expired — refresh and retry once
        upstream.tokenCache.readAt = 0;
        const newToken = await refreshOauthToken(cred.filePath, cred.refreshToken);
        if (newToken) {
          console.log("[upstream] Retrying poll after token refresh...");
          // Recursive call once — next call uses fresh token from cache
          return poll();
        }
        upstream.lastError = "Poll 401 and refresh failed";
      } else {
        upstream.lastError = "Poll HTTP " + resp.status;
      }
      return;
    }

    const data = await resp.json() as any;
    console.log("[upstream] raw keys:", Object.keys(data).join(", "));

    upstream.fiveHour       = data.five_hour       || null;
    upstream.sevenDay       = data.seven_day        || null;
    upstream.sevenDaySonnet = data.seven_day_sonnet || null;
    upstream.sevenDayOpus   = data.seven_day_opus   || null;
    upstream.lastPoll       = Date.now();
    upstream.lastPollOk     = true;
    upstream.lastError      = null;

    // Clear fallback state when Anthropic utilization drops below cap
    // Only if NOT manually overridden to a specific provider
    const override = settings["provider_override"] || "";
    if (upstream.fallbackActive && data.five_hour && override !== "deepseek" && override !== "openrouter") {
      const util = data.five_hour.utilization as number;
      if (util < config.capPct) {
        upstream.fallbackActive = false;
        upstream.fallbackProvider = null;
        console.log("[upstream] Anthropic recovered — fallback cleared");
      }
    }

    dbSaveUpstream().catch(e => console.error("[upstream] dbSaveUpstream error:", e));
    triggerBroadcast();

    const newResetsAt = data.five_hour?.resets_at as string | undefined;
    if (newResetsAt) {
      const resetsAtMs = new Date(newResetsAt).getTime();
      const prevMs     = upstream.lastKnownResetsAt
        ? new Date(upstream.lastKnownResetsAt).getTime() : null;

      if (prevMs !== null && resetsAtMs - prevMs > 30 * 60_000) {
        const delta = resetsAtMs - prevMs;
        if (delta >= 3_600_000 && delta <= 43_200_000) {
          upstream.detectedWindowMs = delta;
          console.log(`[upstream] Detected window: ${Math.round(delta / 60000)}m`);
        }
        const win = upstream.detectedWindowMs || Object.values(tokens)[0]?.window || config.windowMs;
        // Skip Anthropic-driven reset entirely unless the global policy is "auto".
        // manual/daily are decoupled — admin (manual) or midnight (daily) controls them.
        const globalMode = settings["reset_mode"];
        if (globalMode === "auto") {
          for (const tk of Object.values(tokens)) {
            tk.used = 0; tk.window = win; tk.windowStart = resetsAtMs - win; tk.last_reset = resetsAtMs;
          }
          console.log(`[upstream] Window rotated → reset all tokens (mode=auto). resets_at:`, newResetsAt);
          broadcastSystemMsg("🔄 Window reset — usage counters cleared");
        } else {
          console.log(`[upstream] Window rotated but reset_mode=${globalMode || "manual"} — token counters untouched.`);
        }
        lastUtilAlertPct   = 0;
        lastSonnetAlertPct = 0;
        lastOpusAlertPct   = 0;
        upstream.lastKnownResetsAt = newResetsAt;
        dbResetAllTokens(win, resetsAtMs - win).catch(e => console.error("[upstream] dbResetAllTokens error:", e));
        dbSaveUpstream().catch(e => console.error("[upstream] dbSaveUpstream error:", e));
      } else if (prevMs === null) {
        const fh = data.five_hour;
        const untilReset = resetsAtMs - Date.now();
        if (fh && fh.utilization < 5 && untilReset > 3_600_000 && untilReset < 43_200_000) {
          upstream.detectedWindowMs = untilReset;
          console.log(`[upstream] Estimated window: ${Math.round(untilReset / 60000)}m`);
        }
        const win = upstream.detectedWindowMs || Object.values(tokens)[0]?.window || config.windowMs;
        // First-poll alignment — only when global mode is "auto". manual/daily
        // are independent of the Anthropic window.
        if (settings["reset_mode"] === "auto") {
          for (const tk of Object.values(tokens)) {
            tk.window = win; tk.windowStart = resetsAtMs - win;
          }
          console.log("[upstream] First poll. Aligned tokens to resets_at:", newResetsAt);
        }
        upstream.lastKnownResetsAt = newResetsAt;
        dbAlignAllTokens(win, resetsAtMs - win).catch(e => console.error("[upstream] dbAlignAllTokens error:", e));
        dbSaveUpstream().catch(e => console.error("[upstream] dbSaveUpstream error:", e));
      } else if (settings["reset_mode"] === "auto") {
        const win = upstream.detectedWindowMs || Object.values(tokens)[0]?.window || config.windowMs;
        // In-flight realignment — only when global mode is "auto".
        for (const tk of Object.values(tokens)) {
          tk.windowStart = resetsAtMs - win;
        }
      }
    }

    if (data.five_hour) {
      const util = data.five_hour.utilization as number;
      console.log(`[upstream] 5h: ${util}% resets ${data.five_hour.resets_at}`);
      // System messages on utilization milestones (avoid repeat spam)
      if (util >= 95 && lastUtilAlertPct < 95) {
        broadcastSystemMsg(`🚨 Upstream at ${util.toFixed(0)}% — requests are being blocked`);
        lastUtilAlertPct = 95;
      } else if (util >= 80 && lastUtilAlertPct < 80) {
        broadcastSystemMsg(`⚠️ Upstream at ${util.toFixed(0)}% utilization — nearing limit`);
        lastUtilAlertPct = 80;
      } else if (util < 70 && lastUtilAlertPct > 0) {
        lastUtilAlertPct = 0; // reset so next crossing triggers again
      }
    }

    // Model-level alerts — help admin decide when to bulk-pin to another model
    if (data.seven_day_sonnet) {
      const sUtil = data.seven_day_sonnet.utilization as number;
      if (sUtil >= 95 && lastSonnetAlertPct < 95) {
        broadcastSystemMsg(`🔴 Sonnet weekly quota ${sUtil.toFixed(0)}% — consider Pin All → Opus or Haiku`);
        lastSonnetAlertPct = 95;
      } else if (sUtil >= 80 && lastSonnetAlertPct < 80) {
        broadcastSystemMsg(`🟠 Sonnet weekly quota ${sUtil.toFixed(0)}% — nearing limit`);
        lastSonnetAlertPct = 80;
      } else if (sUtil < 70 && lastSonnetAlertPct > 0) {
        lastSonnetAlertPct = 0;
      }
    }
    if (data.seven_day_opus) {
      const oUtil = data.seven_day_opus.utilization as number;
      if (oUtil >= 95 && lastOpusAlertPct < 95) {
        broadcastSystemMsg(`🔴 Opus weekly quota ${oUtil.toFixed(0)}% — consider Pin All → Sonnet`);
        lastOpusAlertPct = 95;
      } else if (oUtil >= 80 && lastOpusAlertPct < 80) {
        broadcastSystemMsg(`🟠 Opus weekly quota ${oUtil.toFixed(0)}% — nearing limit`);
        lastOpusAlertPct = 80;
      } else if (oUtil < 70 && lastOpusAlertPct > 0) {
        lastOpusAlertPct = 0;
      }
    }
  } catch (e: any) {
    upstream.lastPollOk = false;
    upstream.lastError  = "Poll: " + e.message;
  }
}

// Reads current poll interval from settings, falls back to config (env), floor 10s, ceiling 30 min
function getCurrentPollMs(): number {
  const raw = settings["poll_interval_ms"];
  const n   = raw ? parseInt(raw) : NaN;
  if (!Number.isFinite(n) || n < 10_000) return Math.max(10_000, config.pollMs);
  if (n > 30 * 60_000) return 30 * 60_000;
  return n;
}

export function startPoller() {
  const tick = async () => {
    try { await poll(); } catch (e) { console.error("[upstream] poll error:", e); }
    setTimeout(tick, getCurrentPollMs());
  };
  tick();
}
