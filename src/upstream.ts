import fs from "fs";
import path from "path";
import { config } from "./config";
import { upstream, tokens, dbSaveUpstream, dbResetAllTokens, dbAlignAllTokens } from "./state";
import { triggerBroadcast } from "./broadcast";

const TOKEN_CACHE_MS = 30_000;

function readOauthToken(): string | null {
  const now = Date.now();
  if (upstream.tokenCache.value && now - upstream.tokenCache.readAt < TOKEN_CACHE_MS) {
    return upstream.tokenCache.value;
  }
  try {
    const files = fs.readdirSync(config.authDir)
      .filter((f: string) => f.startsWith("claude-") && f.endsWith(".json"));
    if (!files.length) { upstream.lastError = "No claude-*.json in " + config.authDir; return null; }
    for (const f of files) {
      const data = JSON.parse(fs.readFileSync(path.join(config.authDir, f), "utf-8"));
      if (data.disabled || !data.access_token) continue;
      upstream.tokenCache = { value: data.access_token, readAt: now, email: data.email || f };
      return data.access_token;
    }
    upstream.lastError = "All credentials disabled";
    return null;
  } catch (e: any) {
    upstream.lastError = "Read token: " + e.message;
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
  const token = readOauthToken();
  if (!token) { upstream.lastPollOk = false; return; }

  try {
    const resp = await fetch("https://api.anthropic.com/api/oauth/usage", {
      headers: {
        "Authorization":   "Bearer " + token,
        "anthropic-beta":  "oauth-2025-04-20",
        "Accept":          "application/json",
        "User-Agent":      "claude-proxy/2.0",
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
      } else {
        upstream.lastError = "Poll HTTP " + resp.status;
        if (resp.status === 401) upstream.tokenCache.readAt = 0;
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
        const win = upstream.detectedWindowMs
          || Object.values(tokens)[0]?.window
          || config.windowMs;
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
        const win = upstream.detectedWindowMs
          || Object.values(tokens)[0]?.window
          || config.windowMs;
        for (const tk of Object.values(tokens)) {
          tk.window = win; tk.windowStart = resetsAtMs - win;
        }
        console.log("[upstream] First poll. Aligned tokens to resets_at:", newResetsAt);
        upstream.lastKnownResetsAt = newResetsAt;
        dbAlignAllTokens(win, resetsAtMs - win);
        dbSaveUpstream();
      } else {
        const win = upstream.detectedWindowMs
          || Object.values(tokens)[0]?.window
          || config.windowMs;
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
