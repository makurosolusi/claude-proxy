import fs from "fs";
import path from "path";
import { config } from "./config";
import { upstream, tokens, dbSaveUpstream, dbResetAllTokens, dbAlignAllTokens } from "./state";
import { triggerBroadcast } from "./broadcast";

const TOKEN_CACHE_MS    = 30_000;
const OAUTH_CLIENT_ID   = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const OAUTH_REFRESH_URL = "https://api.anthropic.com/v1/oauth/token";

export interface OauthCredential {
  token:        string;
  filePath:     string;
  refreshToken: string;
  email:        string;
}

// Mutex: prevent concurrent refresh calls (refresh tokens are single-use)
let isRefreshing = false;

export function getOauthCredential(): OauthCredential | null {
  const now = Date.now();
  if (upstream.tokenCache.value && now - upstream.tokenCache.readAt < TOKEN_CACHE_MS) {
    return upstream.tokenCache.credential ?? null;
  }
  try {
    const dir   = config.authDir;
    const files = fs.readdirSync(dir).filter((f: string) => f.startsWith("claude-") && f.endsWith(".json"));
    if (!files.length) {
      upstream.lastError = "No claude-*.json in " + dir;
      return null;
    }
    for (const f of files) {
      const fp   = path.join(dir, f);
      const data = JSON.parse(fs.readFileSync(fp, "utf-8"));
      if (data.disabled || !data.access_token || !data.refresh_token) continue;
      const cred: OauthCredential = {
        token:        data.access_token,
        filePath:     fp,
        refreshToken: data.refresh_token,
        email:        data.email || f,
      };
      upstream.tokenCache = { value: data.access_token, readAt: now, email: cred.email, credential: cred };
      return cred;
    }
    upstream.lastError = "All credentials disabled or missing tokens";
    return null;
  } catch (e: any) {
    upstream.lastError = "Read credential: " + e.message;
    return null;
  }
}

export async function refreshOauthToken(filePath: string, refreshToken: string): Promise<string | null> {
  // If a refresh is already in progress, wait for it to finish then return cached value
  if (isRefreshing) {
    await new Promise(r => setTimeout(r, 2000));
    return upstream.tokenCache.value ?? null;
  }
  isRefreshing = true;
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
    upstream.tokenCache = { value: newAccess, readAt: Date.now(), email: cred.email, credential: cred };
    console.log(`[upstream] Token refreshed for ${cred.email}, expires in ${data.expires_in ?? "?"}s`);
    return newAccess;
  } catch (e: any) {
    upstream.lastError = "Token refresh error: " + e.message;
    console.error("[upstream] Token refresh error:", e.message);
    return null;
  } finally {
    isRefreshing = false;
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
  if (!cred) { upstream.lastPollOk = false; return; }

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
    dbSaveUpstream();
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
        for (const tk of Object.values(tokens)) {
          tk.used = 0; tk.window = win; tk.windowStart = resetsAtMs - win;
        }
        console.log("[upstream] Window rotated → reset all users. resets_at:", newResetsAt);
        upstream.lastKnownResetsAt = newResetsAt;
        dbResetAllTokens(win, resetsAtMs - win);
        dbSaveUpstream();
      } else if (prevMs === null) {
        const fh = data.five_hour;
        const untilReset = resetsAtMs - Date.now();
        if (fh && fh.utilization < 5 && untilReset > 3_600_000 && untilReset < 43_200_000) {
          upstream.detectedWindowMs = untilReset;
          console.log(`[upstream] Estimated window: ${Math.round(untilReset / 60000)}m`);
        }
        const win = upstream.detectedWindowMs || Object.values(tokens)[0]?.window || config.windowMs;
        for (const tk of Object.values(tokens)) {
          tk.window = win; tk.windowStart = resetsAtMs - win;
        }
        console.log("[upstream] First poll. Aligned tokens to resets_at:", newResetsAt);
        upstream.lastKnownResetsAt = newResetsAt;
        dbAlignAllTokens(win, resetsAtMs - win);
        dbSaveUpstream();
      } else {
        const win = upstream.detectedWindowMs || Object.values(tokens)[0]?.window || config.windowMs;
        for (const tk of Object.values(tokens)) tk.windowStart = resetsAtMs - win;
      }
    }

    if (data.five_hour) {
      console.log(`[upstream] 5h: ${data.five_hour.utilization}% resets ${data.five_hour.resets_at}`);
    }
  } catch (e: any) {
    upstream.lastPollOk = false;
    upstream.lastError  = "Poll: " + e.message;
  }
}

export function startPoller() {
  poll();
  setInterval(poll, config.pollMs);
}
