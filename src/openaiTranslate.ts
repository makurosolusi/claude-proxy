// Translation layer: Anthropic /v1/messages format <-> OpenAI /v1/chat/completions format.
// Direction A (existing): Client(Anthropic) → anthropicToOpenAi → OpenAI provider → openAiToAnthropic → Client
// Direction B (compat):   Client(OpenAI)    → openAiChatToAnthropic → Anthropic upstream → anthropicToOpenAiResponse → Client
// Tool calls: fully supported in Direction B. Direction A: text-only.

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

// ── Direction B helpers: tool call translation ────────────────────────────────

function translateOpenAiTools(tools: any[]): any[] {
  return tools.map(t => ({
    name:         t.function?.name || "",
    description:  t.function?.description || "",
    input_schema: t.function?.parameters || { type: "object", properties: {} },
  }));
}

function translateOpenAiToolChoice(tc: any): any | undefined {
  if (!tc) return undefined;
  if (tc === "none")           return { type: "none" };
  if (tc === "auto")           return { type: "auto" };
  if (tc === "required")       return { type: "any" };
  if (tc?.type === "function") return { type: "tool", name: tc.function?.name };
  return undefined;
}

function isAllToolResults(m: any): boolean {
  return Array.isArray(m?.content) && m.content.length > 0
    && m.content.every((b: any) => b?.type === "tool_result");
}

// ── Direction B: OpenAI → Anthropic (request) ────────────────────────────────

export function openAiChatToAnthropic(body: any, model: string): any {
  const srcMsgs: any[] = Array.isArray(body.messages) ? body.messages : [];
  const systemParts: string[] = [];
  const preliminary: any[] = [];

  for (const m of srcMsgs) {
    if (m.role === "system") {
      const text = typeof m.content === "string" ? m.content
        : Array.isArray(m.content) ? m.content.filter((b: any) => b?.type === "text").map((b: any) => b.text || "").join("") : "";
      if (text) systemParts.push(text);
      continue;
    }

    if (m.role === "tool") {
      // Single tool_result — will be merged with consecutive ones in pass 2
      const resultContent = typeof m.content === "string" ? m.content
        : Array.isArray(m.content) ? m.content.filter((b: any) => b?.type === "text").map((b: any) => b.text || "").join("") : "";
      preliminary.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: m.tool_call_id || "", content: resultContent }],
      });
      continue;
    }

    if (m.role === "assistant") {
      const content: any[] = [];
      // Text content (may be null for tool-only turns)
      const text = typeof m.content === "string" ? m.content
        : Array.isArray(m.content) ? m.content.filter((b: any) => b?.type === "text").map((b: any) => b.text || "").join("") : "";
      if (text) content.push({ type: "text", text });
      // Tool calls
      if (Array.isArray(m.tool_calls)) {
        for (const tc of m.tool_calls) {
          let input: any = {};
          try { input = JSON.parse(tc.function?.arguments || "{}"); } catch {}
          content.push({ type: "tool_use", id: tc.id || "", name: tc.function?.name || "", input });
        }
      }
      if (content.length > 0) preliminary.push({ role: "assistant", content });
      continue;
    }

    // user role
    const text = typeof m.content === "string" ? m.content
      : Array.isArray(m.content) ? m.content.filter((b: any) => b?.type === "text").map((b: any) => b.text || "").join("") : "";
    if (text) preliminary.push({ role: "user", content: text });
  }

  // Pass 2: merge consecutive user messages that are all tool_results (parallel tool call responses)
  const messages: any[] = [];
  for (const m of preliminary) {
    const prev = messages[messages.length - 1];
    if (prev?.role === "user" && isAllToolResults(prev) && isAllToolResults(m)) {
      prev.content = [...prev.content, ...m.content];
    } else {
      messages.push(m);
    }
  }

  const tools: any[] = Array.isArray(body.tools) ? body.tools : [];
  const out: any = { model, messages, max_tokens: body.max_tokens || 4096, stream: !!body.stream };
  if (systemParts.length) out.system = systemParts.join("\n\n");
  if (tools.length) out.tools = translateOpenAiTools(tools);
  const tc = translateOpenAiToolChoice(body.tool_choice);
  if (tc && tools.length) out.tool_choice = tc;
  if (typeof body.temperature === "number") out.temperature = body.temperature;
  if (typeof body.top_p       === "number") out.top_p       = body.top_p;
  return out;
}

// ── Direction B: Anthropic → OpenAI (non-streaming response) ─────────────────

const ANTHR_TO_OAI_STOP: Record<string, string> = {
  end_turn:   "stop",
  max_tokens: "length",
  tool_use:   "tool_calls",
};

export function anthropicToOpenAiResponse(body: any, originalModel: string): any {
  const content: any[] = Array.isArray(body?.content) ? body.content : [];
  const textBlocks = content.filter((b: any) => b?.type === "text");
  const toolBlocks = content.filter((b: any) => b?.type === "tool_use");

  const messageContent = textBlocks.length > 0
    ? textBlocks.map((b: any) => b.text || "").join("")
    : null;

  const toolCalls = toolBlocks.length > 0
    ? toolBlocks.map((b: any, i: number) => ({
        index: i,
        id:    b.id || ("call_" + randomUUID().replace(/-/g, "").slice(0, 16)),
        type:  "function",
        function: { name: b.name || "", arguments: JSON.stringify(b.input ?? {}) },
      }))
    : undefined;

  const finishReason = ANTHR_TO_OAI_STOP[body?.stop_reason] || "stop";
  return {
    id:      "chatcmpl-" + randomUUID().replace(/-/g, "").slice(0, 24),
    object:  "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model:   originalModel,
    choices: [{
      index: 0,
      message: {
        role:    "assistant",
        content: messageContent,
        ...(toolCalls ? { tool_calls: toolCalls } : {}),
      },
      finish_reason: finishReason,
    }],
    usage: {
      prompt_tokens:     body?.usage?.input_tokens     || 0,
      completion_tokens: body?.usage?.output_tokens    || 0,
      total_tokens:      (body?.usage?.input_tokens || 0) + (body?.usage?.output_tokens || 0),
    },
  };
}

// ── Direction B: Anthropic SSE → OpenAI SSE ──────────────────────────────────

export function translateAnthropicStreamToOpenAi(
  upstream: ReadableStream<Uint8Array>,
  originalModel: string,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const chatId  = "chatcmpl-" + randomUUID().replace(/-/g, "").slice(0, 24);
  const created = Math.floor(Date.now() / 1000);

  function oaiChunk(delta: any, finishReason: string | null): string {
    return `data: ${JSON.stringify({
      id: chatId, object: "chat.completion.chunk", created, model: originalModel,
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    })}\n\n`;
  }

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.getReader();
      let buffer = "";
      let emittedRole = false;
      // Tool call index tracking: Anthropic content block index → OpenAI tool_calls index
      const toolCallIndexMap = new Map<number, number>();
      let nextToolCallIdx = 0;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const parts = buffer.split("\n\n");
          buffer = parts.pop() || "";

          for (const chunk of parts) {
            const eventLine = chunk.split("\n").find(l => l.startsWith("event:"));
            const dataLine  = chunk.split("\n").find(l => l.startsWith("data:"));
            if (!dataLine) continue;

            const payload = dataLine.slice(5).trim();
            let parsed: any;
            try { parsed = JSON.parse(payload); } catch { continue; }

            const event = eventLine ? eventLine.slice(6).trim() : parsed?.type;

            if (event === "message_start" && !emittedRole) {
              emittedRole = true;
              controller.enqueue(encoder.encode(oaiChunk({ role: "assistant", content: "" }, null)));
            } else if (event === "content_block_start" && parsed?.content_block?.type === "tool_use") {
              // Emit tool_calls header: id + name + empty arguments string
              const tcIdx = nextToolCallIdx++;
              toolCallIndexMap.set(parsed.index, tcIdx);
              controller.enqueue(encoder.encode(oaiChunk({
                tool_calls: [{
                  index: tcIdx,
                  id:    parsed.content_block.id || ("call_" + randomUUID().replace(/-/g, "").slice(0, 16)),
                  type:  "function",
                  function: { name: parsed.content_block.name || "", arguments: "" },
                }],
              }, null)));
            } else if (event === "content_block_delta" && parsed?.delta?.type === "text_delta") {
              controller.enqueue(encoder.encode(oaiChunk({ content: parsed.delta.text }, null)));
            } else if (event === "content_block_delta" && parsed?.delta?.type === "input_json_delta") {
              // Emit incremental tool call arguments
              const tcIdx = toolCallIndexMap.get(parsed.index);
              if (tcIdx !== undefined) {
                controller.enqueue(encoder.encode(oaiChunk({
                  tool_calls: [{ index: tcIdx, function: { arguments: parsed.delta.partial_json || "" } }],
                }, null)));
              }
            } else if (event === "message_delta" && parsed?.delta?.stop_reason) {
              const fr = ANTHR_TO_OAI_STOP[parsed.delta.stop_reason] || "stop";
              controller.enqueue(encoder.encode(oaiChunk({}, fr)));
            } else if (event === "message_stop") {
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            }
          }
        }
      } finally {
        if (!emittedRole) {
          controller.enqueue(encoder.encode(oaiChunk({ role: "assistant", content: "" }, null)));
          controller.enqueue(encoder.encode(oaiChunk({}, "stop")));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        }
        controller.close();
      }
    },
  });
}

// ── Direction A: OpenAI SSE → Anthropic SSE (existing) ───────────────────────

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
