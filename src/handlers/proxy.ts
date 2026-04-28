import { config }                              from "../config";
import { upstream, dbLogRequest }             from "../state";
import { checkReset, incrementUsage }         from "../tokens";
import { getOauthCredential, refreshOauthToken } from "../upstream";
import type { TokenEntry }                    from "../types";

// Strip Claude Code system-injected XML tags from user message content
function stripInjections(text: string): string {
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, "")
    .replace(/<command-name>[\s\S]*?<\/command-name>/g, "")
    .replace(/<command-message>[\s\S]*?<\/command-message>/g, "")
    .replace(/<command-args>[\s\S]*?<\/command-args>/g, "")
    .replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g, "")
    .replace(/<user-prompt-submit-hook>[\s\S]*?<\/user-prompt-submit-hook>/g, "")
    .replace(/<[a-z][a-z0-9-]*(?:\s[^>]*)?>[\s\S]*?<\/[a-z][a-z0-9-]*>/g, "") // any remaining known-pattern tags
    .trim();
}

function getRawContent(msg: any): string {
  if (!msg) return "";
  const c = msg.content;
  if (typeof c === "string") return c;
  // Only extract text blocks — skip tool_result, tool_use, image, etc.
  if (Array.isArray(c)) return c.filter((b: any) => b.type === "text").map((b: any) => b.text || "").join("\n");
  return "";
}

function extractPrompt(messages: any[]): string {
  if (!Array.isArray(messages)) return "";
  const userMsgs = messages.filter((m: any) => m.role === "user");
  // Walk backwards: find last user message that has actual text (not just tool_results)
  for (let i = userMsgs.length - 1; i >= 0; i--) {
    const raw = getRawContent(userMsgs[i]);
    if (!raw.trim()) continue; // pure tool_result turn — skip
    const clean = stripInjections(raw);
    if (clean) return clean.slice(0, 2000);
  }
  return "";
}

function extractSystem(body: any): string {
  const s = body?.system;
  if (!s) return "";
  if (typeof s === "string") return s.slice(0, 500);
  if (Array.isArray(s)) return s.filter((b: any) => b.type === "text").map((b: any) => b.text || "").join("\n").slice(0, 500);
  return "";
}

export async function handleProxy(
  req:  Request,
  url:  URL,
  key:  string,
  t:    TokenEntry,
): Promise<Response> {
  const pathname = url.pathname;

  if (t.paused) return Response.json(
    { error: { type: "permission_error", message: "Token is paused by administrator." } },
    { status: 403 }
  );

  checkReset(t, key);

  if (req.method === "GET" && pathname === "/v1/models") {
    return Response.json({
      data: [{ id: "claude-sonnet-4-6", type: "model", display_name: "Claude Sonnet 4.6" }],
      has_more: false,
    });
  }

  if (req.method === "GET" && pathname === "/v1/usage") {
    const resetIn = Math.max(0, Math.ceil((t.windowStart + t.window - Date.now()) / 1000));
    return Response.json({
      used:             t.used,
      limit:            t.limit === Infinity ? "unlimited" : t.limit,
      remaining:        t.limit === Infinity ? "unlimited" : Math.max(0, t.limit - t.used),
      reset_in_seconds: resetIn,
      reset_at:         new Date(t.windowStart + t.window).toISOString(),
      upstream:         upstream.lastPollOk ? { five_hour: upstream.fiveHour, seven_day: upstream.sevenDay } : null,
    });
  }

  if (req.method === "POST" && pathname === "/v1/messages/count_tokens") {
    return Response.json({ input_tokens: 0 });
  }

  if (!(req.method === "POST" && pathname === "/v1/messages")) {
    return Response.json({ error: { type: "not_found_error", message: "Not found" } }, { status: 404 });
  }

  // Soft cap check
  const fh = upstream.fiveHour;
  if (upstream.lastPollOk && fh && fh.utilization >= config.capPct) {
    const resetIn = Math.max(1, Math.ceil((new Date(fh.resets_at).getTime() - Date.now()) / 1000));
    return Response.json({
      error: { type: "rate_limit_error", message: `Upstream near limit (${fh.utilization.toFixed(1)}%). Resets in ${resetIn}s.` }
    }, { status: 429, headers: { "retry-after": String(resetIn) } });
  }

  // Per-user quota
  if (t.used >= t.limit) {
    const resetIn = Math.ceil((t.windowStart + t.window - Date.now()) / 1000);
    return Response.json({
      error: { type: "rate_limit_error", message: `Token quota exceeded (${t.used}/${t.limit}). Resets in ${resetIn}s.` }
    }, {
      status: 429,
      headers: {
        "retry-after":                  String(resetIn),
        "x-ratelimit-limit-tokens":     String(t.limit),
        "x-ratelimit-remaining-tokens": "0",
        "x-ratelimit-reset-tokens":     new Date(t.windowStart + t.window).toISOString(),
      },
    });
  }

  // Read request body to extract model + prompt for logging
  const ts = Date.now();
  let bodyText = "";
  let model = "", prompt = "", systemPrompt = "";
  let turns = 0;
  try {
    bodyText = await req.text();
    const bodyJson = JSON.parse(bodyText);
    model        = bodyJson.model || "";
    prompt       = extractPrompt(bodyJson.messages);
    systemPrompt = extractSystem(bodyJson);
    turns        = Array.isArray(bodyJson.messages) ? Math.ceil(bodyJson.messages.length / 2) : 0;
  } catch {}

  // Build upstream request — resolve effective mode (per-token overrides global)
  const effectiveMode = t.mode !== "inherit" ? t.mode : config.upstreamMode;

  // Direct mode: strip client-specific fields Anthropic API doesn't accept
  // (e.g. context_management sent by Claude Code CLI)
  if (effectiveMode === "direct" && bodyText) {
    try {
      const parsed = JSON.parse(bodyText);
      delete parsed.context_management;
      bodyText = JSON.stringify(parsed);
    } catch {}
  }

  const headers = new Headers(req.headers);
  headers.delete("host");

  let upstreamUrl: string;

  if (effectiveMode === "direct") {
    const cred = getOauthCredential();
    if (!cred) return Response.json(
      { error: { type: "api_error", message: "No valid OAuth credential available." } },
      { status: 503 }
    );
    upstreamUrl = config.anthropicUrl + pathname;
    headers.set("authorization",      "Bearer " + cred.token);
    headers.set("anthropic-version",  "2023-06-01");
    headers.set("anthropic-beta",     "oauth-2025-04-20");
    headers.delete("x-api-key");
  } else {
    upstreamUrl = config.upstream + pathname;
    headers.set("x-api-key",     config.upstreamKey);
    headers.set("authorization", "Bearer " + config.upstreamKey);
  }

  let resp = await fetch(upstreamUrl, { method: "POST", headers, body: bodyText });

  // Direct mode: on 401 refresh token and retry once
  if (effectiveMode === "direct" && resp.status === 401) {
    const cred = getOauthCredential();
    if (cred) {
      console.log("[proxy] 401 from Anthropic, attempting token refresh...");
      const newToken = await refreshOauthToken(cred.filePath, cred.refreshToken);
      if (newToken) {
        headers.set("authorization", "Bearer " + newToken);
        resp = await fetch(upstreamUrl, { method: "POST", headers, body: bodyText });
        console.log("[proxy] Retry after refresh:", resp.status);
      }
    }
  }

  // Shadow mode: when in cliproxy mode, fire-and-forget to direct for comparison
  if (config.shadowDirect && effectiveMode === "cliproxy") {
    const cred = getOauthCredential();
    if (cred) {
      const shadowHeaders = new Headers(headers);
      shadowHeaders.set("authorization",     "Bearer " + cred.token);
      shadowHeaders.set("anthropic-version", "2023-06-01");
      shadowHeaders.set("anthropic-beta",    "oauth-2025-04-20");
      shadowHeaders.delete("x-api-key");
      fetch(config.anthropicUrl + pathname, { method: "POST", headers: shadowHeaders, body: bodyText })
        .then(async sr => {
          const diff = sr.status !== resp.status ? ` status_diff=${resp.status}vs${sr.status}` : "";
          console.log(`[shadow] direct=${sr.status}${diff}`);
        })
        .catch(e => console.warn("[shadow] error:", e.message));
    }
  }

  const remaining   = Math.max(0, t.limit === Infinity ? 999_999_999 : t.limit - t.used);
  const rateHeaders = {
    "x-ratelimit-limit-tokens":     t.limit === Infinity ? "unlimited" : String(t.limit),
    "x-ratelimit-remaining-tokens": String(remaining),
    "x-ratelimit-reset-tokens":     new Date(t.windowStart + t.window).toISOString(),
  };

  const isStream = resp.headers.get("content-type")?.includes("text/event-stream");

  if (isStream) {
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const decoder = new TextDecoder();
    const httpStatus = resp.status;
    (async () => {
      const reader = resp.body!.getReader();
      let buffer = "";
      let inputTokens = 0, outputTokens = 0, cacheRead = 0, cacheCreation = 0;
      let stopReason = "", toolUseCount = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          await writer.write(value);
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === "message_start" && data.message?.usage) {
                inputTokens    = data.message.usage.input_tokens || 0;
                cacheRead      = data.message.usage.cache_read_input_tokens || 0;
                cacheCreation  = data.message.usage.cache_creation_input_tokens || 0;
                incrementUsage(key, inputTokens);
              }
              if (data.type === "message_delta" && data.usage) {
                outputTokens = data.usage.output_tokens || 0;
                stopReason   = data.delta?.stop_reason || stopReason;
                incrementUsage(key, outputTokens);
                console.log(`[${key.slice(-6)}] ${t.used.toLocaleString()}/${t.limit === Infinity ? "∞" : t.limit.toLocaleString()}`);
              }
              if (data.type === "content_block_start" && data.content_block?.type === "tool_use") {
                toolUseCount++;
              }
            } catch {}
          }
        }
      } finally {
        await writer.close();
        dbLogRequest({ ts, token_key: key, model, input_tokens: inputTokens, output_tokens: outputTokens,
          cache_read: cacheRead, cache_creation: cacheCreation, stream: true, status: httpStatus,
          stop_reason: stopReason, tool_use_count: toolUseCount, duration_ms: Date.now() - ts,
          turns, prompt, system_prompt: systemPrompt });
      }
    })();
    const outHeaders = new Headers(resp.headers);
    for (const [k, v] of Object.entries(rateHeaders)) outHeaders.set(k, v);
    return new Response(readable, { status: resp.status, headers: outHeaders });
  }

  const body = await resp.json() as any;
  const inputTokens    = body?.usage?.input_tokens  || 0;
  const outputTokens   = body?.usage?.output_tokens || 0;
  const cacheRead      = body?.usage?.cache_read_input_tokens || 0;
  const cacheCreation  = body?.usage?.cache_creation_input_tokens || 0;
  const stopReason     = body?.stop_reason || "";
  const toolUseCount   = Array.isArray(body?.content)
    ? body.content.filter((b: any) => b.type === "tool_use").length : 0;
  if (inputTokens || outputTokens) {
    incrementUsage(key, inputTokens + outputTokens);
    console.log(`[${key.slice(-6)}] ${t.used.toLocaleString()}/${t.limit === Infinity ? "∞" : t.limit.toLocaleString()}`);
  }
  dbLogRequest({ ts, token_key: key, model, input_tokens: inputTokens, output_tokens: outputTokens,
    cache_read: cacheRead, cache_creation: cacheCreation, stream: false, status: resp.status,
    stop_reason: stopReason, tool_use_count: toolUseCount, duration_ms: Date.now() - ts,
    turns, prompt, system_prompt: systemPrompt });
  return Response.json(body, { status: resp.status, headers: rateHeaders });
}
