// Translation layer: Anthropic /v1/messages format <-> OpenAI /v1/chat/completions format.
// Used when a custom provider declares type="openai" — the proxy receives Anthropic-format
// requests (Claude Code clients), forwards as OpenAI format, and translates the response back.
//
// Scope (MVP):
//   - Text content (no tool_use / tool_result yet — those would need more complex mapping)
//   - System prompt as top-level → first system message
//   - Streaming: OpenAI SSE chunks → Anthropic SSE events
//   - Non-streaming: full JSON body translation
//   - Stop reasons mapped: stop→end_turn, length→max_tokens

import { randomUUID } from "crypto";

// ── Request: Anthropic body → OpenAI body ─────────────────────────────────────

interface AnthropicMessage {
  role:    string;
  content: any;
}

interface OpenAIMessage {
  role:    string;
  content: string;
}

function anthropicContentToText(content: any): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b: any) => b?.type === "text")
    .map((b: any) => b.text || "")
    .join("");
}

function anthropicSystemToText(system: any): string {
  if (!system) return "";
  if (typeof system === "string") return system;
  if (Array.isArray(system)) {
    return system
      .filter((b: any) => b?.type === "text")
      .map((b: any) => b.text || "")
      .join("\n\n");
  }
  return "";
}

export function anthropicToOpenAi(body: any, providerModel: string): any {
  const messages: OpenAIMessage[] = [];

  const sys = anthropicSystemToText(body.system);
  if (sys) messages.push({ role: "system", content: sys });

  const srcMsgs: AnthropicMessage[] = Array.isArray(body.messages) ? body.messages : [];
  for (const m of srcMsgs) {
    const role = m.role === "assistant" ? "assistant" : "user";
    const text = anthropicContentToText(m.content);
    if (text) messages.push({ role, content: text });
  }

  const out: any = {
    model:        providerModel,
    messages,
    max_tokens:   body.max_tokens || 4096,
    stream:       !!body.stream,
  };
  if (typeof body.temperature === "number") out.temperature = body.temperature;
  if (typeof body.top_p === "number")        out.top_p       = body.top_p;
  return out;
}

// ── Response (non-streaming): OpenAI JSON → Anthropic JSON ───────────────────

const STOP_MAP: Record<string, string> = {
  stop:           "end_turn",
  length:         "max_tokens",
  tool_calls:     "tool_use",
  content_filter: "end_turn",
  function_call:  "tool_use",
};

export function openAiToAnthropic(body: any, originalModel: string): any {
  const choice = body?.choices?.[0];
  const text   = choice?.message?.content || "";
  const stop   = STOP_MAP[choice?.finish_reason] || "end_turn";

  const inputTokens  = body?.usage?.prompt_tokens     || 0;
  const outputTokens = body?.usage?.completion_tokens || 0;

  return {
    id:           "msg_" + randomUUID().replace(/-/g, "").slice(0, 24),
    type:         "message",
    role:         "assistant",
    model:        originalModel,
    content:      text ? [{ type: "text", text }] : [],
    stop_reason:  stop,
    stop_sequence: null,
    usage: {
      input_tokens:                inputTokens,
      output_tokens:               outputTokens,
      cache_read_input_tokens:     0,
      cache_creation_input_tokens: 0,
    },
  };
}

// ── Response (streaming): OpenAI SSE → Anthropic SSE ─────────────────────────

interface StreamState {
  messageId:      string;
  originalModel:  string;
  inputTokens:    number;
  outputTokens:   number;
  emittedStart:   boolean;
  emittedBlock:   boolean;
  finishReason:   string;
}

function sseEvent(event: string, data: any): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function emitMessageStart(state: StreamState): string {
  state.emittedStart = true;
  return sseEvent("message_start", {
    type: "message_start",
    message: {
      id:           state.messageId,
      type:         "message",
      role:         "assistant",
      content:      [],
      model:        state.originalModel,
      stop_reason:  null,
      stop_sequence: null,
      usage: {
        input_tokens:                state.inputTokens,
        output_tokens:               0,
        cache_read_input_tokens:     0,
        cache_creation_input_tokens: 0,
      },
    },
  });
}

function emitContentBlockStart(): string {
  return sseEvent("content_block_start", {
    type: "content_block_start",
    index: 0,
    content_block: { type: "text", text: "" },
  });
}

function emitContentBlockDelta(text: string): string {
  return sseEvent("content_block_delta", {
    type: "content_block_delta",
    index: 0,
    delta: { type: "text_delta", text },
  });
}

function emitContentBlockStop(): string {
  return sseEvent("content_block_stop", { type: "content_block_stop", index: 0 });
}

function emitMessageDelta(state: StreamState): string {
  const stop = STOP_MAP[state.finishReason] || "end_turn";
  return sseEvent("message_delta", {
    type: "message_delta",
    delta: { stop_reason: stop, stop_sequence: null },
    usage: { output_tokens: state.outputTokens },
  });
}

function emitMessageStop(): string {
  return sseEvent("message_stop", { type: "message_stop" });
}

// Transform an OpenAI SSE byte stream into an Anthropic SSE byte stream.
export function translateOpenAiStreamToAnthropic(
  upstream: ReadableStream<Uint8Array>,
  originalModel: string,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const state: StreamState = {
        messageId:    "msg_" + randomUUID().replace(/-/g, "").slice(0, 24),
        originalModel,
        inputTokens:  0,
        outputTokens: 0,
        emittedStart: false,
        emittedBlock: false,
        finishReason: "stop",
      };

      const reader = upstream.getReader();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // SSE chunks separated by blank line
          const parts = buffer.split("\n\n");
          buffer = parts.pop() || "";

          for (const chunk of parts) {
            const dataLines = chunk.split("\n").filter(l => l.startsWith("data:"));
            for (const line of dataLines) {
              const payload = line.slice(5).trim();
              if (!payload) continue;
              if (payload === "[DONE]") continue;

              let parsed: any;
              try { parsed = JSON.parse(payload); }
              catch { continue; }

              // Emit message_start on first chunk
              if (!state.emittedStart) {
                if (parsed?.usage?.prompt_tokens) state.inputTokens = parsed.usage.prompt_tokens;
                controller.enqueue(encoder.encode(emitMessageStart(state)));
              }

              const choice = parsed?.choices?.[0];
              if (!choice) continue;

              // First content delta — emit content_block_start
              const delta = choice.delta?.content;
              if (delta && !state.emittedBlock) {
                controller.enqueue(encoder.encode(emitContentBlockStart()));
                state.emittedBlock = true;
              }

              if (delta) {
                state.outputTokens++; // rough estimate per delta
                controller.enqueue(encoder.encode(emitContentBlockDelta(delta)));
              }

              if (choice.finish_reason) {
                state.finishReason = choice.finish_reason;
              }

              // Final usage if upstream provides it
              if (parsed?.usage?.completion_tokens) state.outputTokens = parsed.usage.completion_tokens;
            }
          }
        }
      } finally {
        // Always emit closing events
        if (state.emittedBlock) controller.enqueue(encoder.encode(emitContentBlockStop()));
        if (state.emittedStart) {
          controller.enqueue(encoder.encode(emitMessageDelta(state)));
          controller.enqueue(encoder.encode(emitMessageStop()));
        }
        controller.close();
      }
    },
  });
}
