import { tokens, upstream, dailyUsage, totalTokensAllTime, allTimePerUser, recentLogs, settings, resolveTokenName, resolveOwnerName, resolveTokenLabel } from "../state";
import type { ContextAlert, ThresholdAlert, UserInsight, UserProfile } from "../contexts";
import { todayKey } from "../tokens";
import { getCustomProvider } from "../customProviders";

function avg(arr: number[]): number {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}

function dayKey(offsetDays: number): string {
  return new Date(Date.now() - offsetDays * 86400_000).toISOString().slice(0, 10);
}

function computeInsights(
  key: string,
  label: string,
  limit: number | null,
  used: number,
  today: number,
): UserInsight {
  // ── 7-day sparkline ────────────────────────────────────────────────────────
  const sparkline = Array.from({ length: 7 }, (_, i) =>
    dailyUsage[dayKey(6 - i)]?.[key] ?? 0
  );

  // ── Burn rate ──────────────────────────────────────────────────────────────
  const activeDays   = sparkline.filter(v => v > 0);
  const avgDaily     = activeDays.length ? avg(activeDays) : 0;
  const spikeMultiple = avgDaily > 0 ? Math.round((today / avgDaily) * 10) / 10 : 0;
  const remaining    = limit != null ? Math.max(0, limit - used) : null;
  const hoursLeft    = remaining != null && avgDaily > 0
    ? Math.round((remaining / (avgDaily / 24)) * 10) / 10
    : null;

  // ── Behavioral profile from recent logs ───────────────────────────────────
  const userLogs = recentLogs
    .filter(l => l.token_key === key && l.status < 400)
    .slice(0, 30);

  let profile: UserProfile = "mixed";
  let profileReason = "Belum cukup data untuk klasifikasi.";
  let cacheHitRate = 0;
  let avgInputTokens = 0;
  const stopReasons: Record<string, number> = {};

  if (userLogs.length >= 3) {
    const avgToolUse  = avg(userLogs.map(l => l.tool_use_count));
    const avgTurns    = avg(userLogs.map(l => l.turns));
    const avgInp      = avg(userLogs.map(l => l.input_tokens));
    const avgOut      = avg(userLogs.map(l => l.output_tokens));
    const totalCache  = userLogs.reduce((s, l) => s + l.cache_read, 0);
    const totalInp    = userLogs.reduce((s, l) => s + l.input_tokens, 0);
    const hitRate     = totalInp + totalCache > 0 ? totalCache / (totalInp + totalCache) : 0;

    cacheHitRate     = Math.round(hitRate * 100) / 100;
    avgInputTokens   = Math.round(avgInp);

    for (const l of userLogs) {
      if (l.stop_reason) stopReasons[l.stop_reason] = (stopReasons[l.stop_reason] ?? 0) + 1;
    }

    if (avgToolUse > 8 && avgTurns > 8) {
      profile = "agentic";
      profileReason = `Rata-rata ${avgToolUse.toFixed(1)} tool calls/req dan ${avgTurns.toFixed(0)} turns — mode agentic berat.`;
    } else if (hitRate > 0.65 && avgInp > 40_000) {
      profile = "heavy_reader";
      profileReason = `${(hitRate * 100).toFixed(0)}% token dari cache — sering membaca file atau context besar.`;
    } else if (avgInp / Math.max(avgOut, 1) < 8 && avgTurns < 5) {
      profile = "conversational";
      profileReason = `Rasio input/output rendah (${(avgInp / Math.max(avgOut, 1)).toFixed(1)}×), sesi pendek — gaya percakapan.`;
    } else if (avgOut / Math.max(avgInp, 1) > 0.15) {
      profile = "efficient";
      profileReason = `Output tinggi relatif terhadap input (${(avgOut / Math.max(avgInp, 1) * 100).toFixed(0)}%) — penggunaan efisien.`;
    } else {
      profileReason = `Pola campuran: ${avgToolUse.toFixed(1)} tool/req, ${avgTurns.toFixed(0)} turns, rasio ${(avgInp/Math.max(avgOut,1)).toFixed(0)}×.`;
    }
  }

  // ── Quota suggestion from 14-day pattern ──────────────────────────────────
  let quotaSuggestion: UserInsight["quotaSuggestion"] = null;
  if (limit != null && activeDays.length >= 5) {
    const p90   = [...sparkline].sort((a, b) => a - b)[Math.floor(sparkline.length * 0.9)] ?? 0;
    const ratio = p90 / limit;
    if (ratio > 0.9) {
      const suggested = Math.ceil(p90 * 1.3 / 10_000) * 10_000;
      quotaSuggestion = { action: "increase", suggested, reason: `P90 harian ${(ratio * 100).toFixed(0)}% dari limit — sering hampir penuh.` };
    } else if (ratio < 0.15 && sparkline.some(v => v > 0)) {
      const suggested = Math.max(Math.ceil(p90 * 2 / 10_000) * 10_000, 10_000);
      quotaSuggestion = { action: "decrease", suggested, reason: `Pemakaian hanya ${(ratio * 100).toFixed(0)}% dari limit — bisa diturunkan.` };
    } else {
      quotaSuggestion = { action: "ok", suggested: null, reason: `Limit saat ini sesuai (P90 = ${(ratio * 100).toFixed(0)}%).` };
    }
  }

  return { sparkline, burnRate: { hoursLeft, avgDaily, spikeMultiple }, profile, profileReason, cacheHitRate, avgInputTokens, stopReasons, quotaSuggestion };
}

function fmtCd(ms: number) {
  if (ms <= 0) return "now";
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

export function handleApiStatus(req: Request, url: URL, isAdmin: boolean, userImages: Record<string, string> = {}): Response {
  const now   = Date.now();
  const today = todayKey();

  // Resolved global active provider (same logic as proxy.ts).
  // Handles built-in + custom providers via getCustomProvider lookup.
  const globalOverride = settings["provider_override"] || "";
  const isOverrideValid =
    ["anthropic", "deepseek", "openrouter"].includes(globalOverride) ||
    (globalOverride !== "" && !!getCustomProvider(globalOverride)?.api_key);
  const globalActiveProvider: string = isOverrideValid
    ? globalOverride
    : (upstream.fallbackProvider ?? "anthropic");

  const tokenData: Record<string, any> = {};
  for (const [k, tk] of Object.entries(tokens)) {
    const tp = tk.provider || "inherit";
    const effectiveProvider = tp === "inherit" ? globalActiveProvider : tp;
    // active model: pinned_model wins; else provider's default
    const activeModel = tk.pinned_model
      ? tk.pinned_model
      : effectiveProvider === "deepseek"   ? (settings["deepseek_model"]   || "deepseek-v4-pro[1m]")
      : effectiveProvider === "openrouter" ? (settings["openrouter_model"] || "anthropic/claude-sonnet-4")
      : null;
    const resolvedName = resolveTokenName(k, tk);
    const ownerName    = resolveOwnerName(tk);
    const tokenLabel   = resolveTokenLabel(k, tk);
    tokenData[k] = {
      label:           resolvedName,
      name:            resolvedName,
      user_id:         tk.user_id || "",
      owner_name:      ownerName,
      token_label:     tokenLabel,
      used:            tk.used,
      limit:           tk.limit === Infinity ? null : tk.limit,
      remaining:       tk.limit === Infinity ? null : Math.max(0, tk.limit - tk.used),
      pct:             tk.limit === Infinity ? 0 : Math.round((tk.used / tk.limit) * 100),
      paused:          tk.paused,
      today:           (dailyUsage[today] || {})[k] || 0,
      alltime:         allTimePerUser[k] || 0,
      provider:        tp,
      pinned_model:    tk.pinned_model || "",
      activeProvider:  effectiveProvider,
      activeModel,
    };
  }

  // ── Per-user insights ────────────────────────────────────────────────────
  const insights: Record<string, UserInsight> = {};
  for (const [k, td] of Object.entries(tokenData)) {
    insights[k] = computeInsights(k, td.label, td.limit, td.used, td.today);
  }

  // ── Threshold alerts (new events since last poll) ─────────────────────────
  const thresholdAlerts: ThresholdAlert[] = [];
  const fiveMinAgo = now - 5 * 60 * 1000;
  for (const [k, td] of Object.entries(tokenData)) {
    if (!td.limit) continue;
    const pct = Math.round((td.used / td.limit) * 100);
    // check recent logs for this user in last 5 min
    const recentForUser = recentLogs.filter(l => l.token_key === k && l.ts > fiveMinAgo);
    if (recentForUser.length > 0) {
      // high context in latest request
      const latest = recentForUser[0]!;
      if (latest.input_tokens > 80_000) {
        thresholdAlerts.push({ label: td.label, type: "high_context", value: latest.input_tokens, ts: latest.ts,
          msg: `${td.label}: request terakhir menggunakan ${(latest.input_tokens/1000).toFixed(0)}k tokens input. Jalankan /compact.` });
      }
      // error storm: 3+ errors in last 5 min
      const errors = recentForUser.filter(l => l.status >= 400);
      if (errors.length >= 3) {
        thresholdAlerts.push({ label: td.label, type: "error_storm", value: errors.length, ts: now,
          msg: `${td.label}: ${errors.length} errors dalam 5 menit. Cek credential atau quota.` });
      }
    }
    if (pct >= 95) {
      thresholdAlerts.push({ label: td.label, type: "quota_95", value: pct, ts: now,
        msg: `${td.label}: quota ${pct}% — hampir habis!` });
    } else if (pct >= 80) {
      thresholdAlerts.push({ label: td.label, type: "quota_80", value: pct, ts: now,
        msg: `${td.label}: quota ${pct}% — mendekati batas.` });
    }
  }
  // upstream alert
  const fh = upstream.fiveHour;
  if (fh && fh.utilization >= 85) {
    thresholdAlerts.push({ label: "Upstream", type: "upstream_85", value: Math.round(fh.utilization), ts: now,
      msg: `Upstream 5-hour utilization ${Math.round(fh.utilization)}% — semua request berisiko diblok.` });
  }

  // ── Context anomaly detection ─────────────────────────────────────────────
  const twoHoursAgo = now - 2 * 60 * 60 * 1000;
  // Latest successful request per user within 2 hours
  const latestPerUser = new Map<string, typeof recentLogs[number]>();
  for (const log of recentLogs) {
    if (log.ts < twoHoursAgo || log.status >= 400) continue;
    if (!latestPerUser.has(log.token_key)) latestPerUser.set(log.token_key, log);
  }

  const contextAlerts: ContextAlert[] = [];
  for (const [key, log] of latestPerUser) {
    const inp   = log.input_tokens;
    const out   = log.output_tokens;
    const ratio = Math.round(inp / Math.max(out, 1));
    const td    = tokenData[key];
    if (!td) continue;

    const isCritical = inp > 100_000;
    const isWarning  = !isCritical && (inp > 50_000 || (ratio > 80 && inp > 20_000));
    if (!isCritical && !isWarning) continue;

    contextAlerts.push({
      label:        td.label,
      input_tokens: inp,
      output_tokens:out,
      turns:        log.turns,
      ratio,
      severity:     isCritical ? "critical" : "warning",
      ts:           log.ts,
    });
  }
  // Worst severity first
  contextAlerts.sort((a, b) =>
    (b.severity === "critical" ? 1 : 0) - (a.severity === "critical" ? 1 : 0) ||
    b.input_tokens - a.input_tokens
  );

  return Response.json({
    ts:          new Date().toISOString(),
    pollAge:     upstream.lastPoll ? fmtCd(now - upstream.lastPoll) + " ago" : "pending",
    isAdmin,
    totalAllTime:    totalTokensAllTime,
    contextAlerts,
    thresholdAlerts,
    insights,
    tokens:          tokenData,
    upstream: {
      ok:     upstream.lastPollOk,
      stale:  !upstream.lastPollOk && !!upstream.fiveHour,
      error:  isAdmin ? upstream.lastError : null,
      email:  isAdmin ? upstream.tokenCache.email : null,
      pollAge:   upstream.lastPoll ? fmtCd(now - upstream.lastPoll) : null,
      nextPoll:  upstream.pollBackoffUntil > now ? fmtCd(upstream.pollBackoffUntil - now) : null,
      fiveHour:       upstream.fiveHour,
      sevenDay:       upstream.sevenDay,
      sevenDaySonnet: upstream.sevenDaySonnet,
      sevenDayOpus:   upstream.sevenDayOpus,
      fallbackProvider: upstream.fallbackProvider,
      activeProvider: (() => {
        const override = settings["provider_override"] || "";
        if (override === "deepseek")   return "deepseek";
        if (override === "openrouter") return "openrouter";
        if (override === "anthropic")  return null;
        return upstream.fallbackProvider; // auto mode: runtime wins
      })(),
      activeModel: (() => {
        const override = settings["provider_override"] || "";
        const fp = override || upstream.fallbackProvider;
        if (fp === "deepseek")   return settings["deepseek_model"]   || "deepseek-v4-pro[1m]";
        if (fp === "openrouter") return settings["openrouter_model"] || "anthropic/claude-sonnet-4";
        return null;
      })(),
    },
    userImages,
  }, { headers: { "Cache-Control": "no-store" } });
}
