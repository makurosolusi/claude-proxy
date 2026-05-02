import { config }          from "../config";
import { upstream, dbLogRequest, dailyUsage } from "../state";
import { checkReset, incrementUsage, getInFlight, reserveInFlight, releaseInFlight, getGeneration, todayKey } from "../tokens";
import { getOauthCredential, refreshOauthToken } from "../upstream";
import { broadcastSystemMsg } from "../broadcast";
import type { TokenEntry } from "../types";

function pushAlert(msg: string) { broadcastSystemMsg(`⚡ ${msg}`); }

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

function extractTranscript(messages: any[]): string {
  if (!Array.isArray(messages)) return "";
  const turns = messages
    .map(m => ({
      role: m.role === "assistant" ? "assistant" : "user",
      text: getRawContent(m).slice(0, 1500),
    }))
    .filter(t => t.text.trim());
  return JSON.stringify(turns).slice(0, 8000);
}

function extractResponseText(body: any): string {
  if (!body?.content || !Array.isArray(body.content)) return "";
  return body.content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text || "")
    .join("")
    .slice(0, 3000);
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
    try {
      const cred = getOauthCredential();
      if (!cred) throw new Error("no credential");
      const r = await fetch(config.anthropicUrl + "/v1/models", {
        headers: {
          "Accept":           "application/json",
          "Authorization":    "Bearer " + cred.token,
          "anthropic-version": "2023-06-01",
          "anthropic-beta":   "oauth-2025-04-20",
        },
      });
      if (r.ok) return new Response(r.body, { status: 200, headers: { "Content-Type": "application/json" } });
    } catch {}
    return Response.json({
      data: [
        { id: "claude-opus-4-7",           type: "model", display_name: "Claude Opus 4.7" },
        { id: "claude-sonnet-4-6",         type: "model", display_name: "Claude Sonnet 4.6" },
        { id: "claude-haiku-4-5-20251001", type: "model", display_name: "Claude Haiku 4.5" },
      ],
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

  // Per-user quota — include in-flight reservations from concurrent requests
  const inFlightNow = getInFlight(key);
  if (t.used + inFlightNow >= t.limit) {
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

  // Parse request body ONCE — used for logging, estimation, and stripping extra fields
  const ts = Date.now();
  let bodyText = "";
  let bodyJson: any = null;
  let model = "", prompt = "", systemPrompt = "", messagesJson = "";
  let maxOutputTokens = 4096;
  let turns = 0;
  try {
    bodyText = await req.text();
    bodyJson = JSON.parse(bodyText);
    model          = bodyJson.model || "";
    prompt         = extractPrompt(bodyJson.messages);
    systemPrompt   = extractSystem(bodyJson);
    messagesJson   = extractTranscript(bodyJson.messages);
    turns          = Array.isArray(bodyJson.messages) ? Math.ceil(bodyJson.messages.length / 2) : 0;
    maxOutputTokens = parseInt(bodyJson.max_tokens) || 4096;
  } catch {}

  // Strip client-specific fields Anthropic API doesn't accept
  if (bodyJson) {
    delete bodyJson.context_management;
    bodyText = JSON.stringify(bodyJson);
  }

  // Estimate TOTAL tokens (input + output) for reservation.
  // max_tokens is only the OUTPUT limit. Input can be huge (100k+ for Claude Code).
  // Count actual message chars and convert to approximate tokens (1 token ≈ 3.5 chars).
  const estimatedTokens = (() => {
    let chars = 0;
    try {
      for (const msg of (bodyJson?.messages || [])) {
        const c = msg.content;
        if (typeof c === "string") chars += c.length;
        else if (Array.isArray(c)) {
          for (const b of c) {
            chars += b.type === "text" ? (b.text || "").length
                   : Math.ceil(JSON.stringify(b).length * 0.5);
          }
        }
      }
      const sys = bodyJson?.system;
      if (typeof sys === "string") chars += sys.length;
      else if (Array.isArray(sys)) chars += JSON.stringify(sys).length;
    } catch {}
    return Math.ceil(chars / 3.5) + 300 + maxOutputTokens;
  })();

  // Snapshot generation at request start — stale increments ignored after reset
  const reqGen = getGeneration(key);

  // Reserve with unique ID — guaranteed release via try-finally below.
  // Using estimatedTokens only (not "full remaining quota") to allow reasonable
  // concurrency while still limiting overshoot. TTL=10min auto-expires leaked reservations.
  const reservationId = reserveInFlight(key, estimatedTokens);

  // ── Build request ────────────────────────────────────────────────────────────
  const cred = getOauthCredential();
  if (!cred) {
    releaseInFlight(key, reservationId);
    return Response.json({ error: { type: "api_error", message: "No valid OAuth credential available." } }, { status: 503 });
  }

  const headers = new Headers(req.headers);
  headers.delete("host");
  headers.delete("x-api-key");
  headers.set("authorization", "Bearer " + cred.token);
  headers.set("anthropic-version", "2023-06-01");
  headers.set("anthropic-beta", "oauth-2025-04-20");

  const upstreamUrl = config.anthropicUrl + pathname;

  // ── Forward & respond — reservation ALWAYS released via try-finally ─────────
  try {
    let resp = await fetch(upstreamUrl, { method: "POST", headers, body: bodyText });

    // 401 → refresh token → retry once
    if (resp.status === 401) {
      const newToken = await refreshOauthToken(cred.filePath, cred.refreshToken);
      if (newToken) {
        headers.set("authorization", "Bearer " + newToken);
        resp = await fetch(upstreamUrl, { method: "POST", headers, body: bodyText });
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
      // Streaming async — reservation released in its own finally
      (async () => {
        const reader = resp.body!.getReader();
        let buffer = "";
        let inputTokens = 0, outputTokens = 0, cacheRead = 0, cacheCreation = 0;
        let stopReason = "", toolUseCount = 0, responseText = "";
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
                  inputTokens   = data.message.usage.input_tokens || 0;
                  cacheRead     = data.message.usage.cache_read_input_tokens || 0;
                  cacheCreation = data.message.usage.cache_creation_input_tokens || 0;
                  incrementUsage(key, inputTokens, reqGen);
                }
                if (data.type === "message_delta" && data.usage) {
                  outputTokens = data.usage.output_tokens || 0;
                  stopReason   = data.delta?.stop_reason || stopReason;
                  incrementUsage(key, outputTokens, reqGen);
                  console.log(`[${key.slice(-6)}] ${t.used.toLocaleString()}/${t.limit === Infinity ? "∞" : t.limit.toLocaleString()}`);
                }
                if (data.type === "content_block_start" && data.content_block?.type === "tool_use") toolUseCount++;
                if (data.type === "content_block_delta" && data.delta?.type === "text_delta" && responseText.length < 3000)
                  responseText += data.delta.text || "";
              } catch {}
            }
          }
        } finally {
          await writer.close().catch(() => {});
          releaseInFlight(key, reservationId);
          dbLogRequest({ ts, token_key: key, name: t.name, model, input_tokens: inputTokens, output_tokens: outputTokens,
            cache_read: cacheRead, cache_creation: cacheCreation, stream: true, status: httpStatus,
            stop_reason: stopReason, tool_use_count: toolUseCount, duration_ms: Date.now() - ts,
            turns, prompt, system_prompt: systemPrompt,
            messages_json: messagesJson, response_text: responseText.slice(0, 3000) });
          // Real-time threshold alerts
          if (inputTokens > 80_000)
            pushAlert(`${t.name}: ${(inputTokens/1000).toFixed(0)}k tokens input — context sangat besar, jalankan /compact`);
          if (t.limit !== Infinity) {
            const pct = Math.round((t.used / t.limit) * 100);
            if (pct >= 95) pushAlert(`${t.name}: quota ${pct}% — hampir habis!`);
            else if (pct === 80) pushAlert(`${t.name}: quota 80% — mendekati batas.`);
          }
        }
      })();
      const outHeaders = new Headers(resp.headers);
      for (const [k, v] of Object.entries(rateHeaders)) outHeaders.set(k, v);
      // Note: reservation released inside the async stream finally above, not here
      return new Response(readable, { status: resp.status, headers: outHeaders });
    }

    // Non-streaming
    const body         = await resp.json() as any;
    const inputTokens  = body?.usage?.input_tokens  || 0;
    const outputTokens = body?.usage?.output_tokens || 0;
    const cacheRead    = body?.usage?.cache_read_input_tokens || 0;
    const cacheCreation= body?.usage?.cache_creation_input_tokens || 0;
    const stopReason   = body?.stop_reason || "";
    const toolUseCount = Array.isArray(body?.content) ? body.content.filter((b: any) => b.type === "tool_use").length : 0;
    releaseInFlight(key, reservationId);
    if (inputTokens || outputTokens) {
      incrementUsage(key, inputTokens + outputTokens, reqGen);
      console.log(`[${key.slice(-6)}] ${t.used.toLocaleString()}/${t.limit === Infinity ? "∞" : t.limit.toLocaleString()}`);
    }
    dbLogRequest({ ts, token_key: key, name: t.name, model, input_tokens: inputTokens, output_tokens: outputTokens,
      cache_read: cacheRead, cache_creation: cacheCreation, stream: false, status: resp.status,
      stop_reason: stopReason, tool_use_count: toolUseCount, duration_ms: Date.now() - ts,
      turns, prompt, system_prompt: systemPrompt,
      messages_json: messagesJson, response_text: extractResponseText(body) });
    if (inputTokens > 80_000)
      pushAlert(`${t.name}: ${(inputTokens/1000).toFixed(0)}k tokens input — jalankan /compact`);
    if (t.limit !== Infinity) {
      const pct = Math.round((t.used / t.limit) * 100);
      if (pct >= 95) pushAlert(`${t.name}: quota ${pct}% — hampir habis!`);
    }
    return Response.json(body, { status: resp.status, headers: rateHeaders });

  } catch (err: any) {
    // Always release on exception — prevents reservation leaks
    releaseInFlight(key, reservationId);
    console.error("[proxy] upstream error:", err.message);
    return Response.json({ error: { type: "api_error", message: "Upstream request failed: " + err.message } }, { status: 502 });
  }
}
