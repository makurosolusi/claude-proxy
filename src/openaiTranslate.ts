// Translation layer: Anthropic /v1/messages format <-> OpenAI /v1/chat/completions format.
// Direction A (existing): Client(Anthropic) → anthropicToOpenAi → OpenAI provider → openAiToAnthropic → Client
// Direction B (compat):   Client(OpenAI)    → openAiChatToAnthropic → Anthropic upstream → anthropicToOpenAiResponse → Client
// Tool calls: fully supported in both directions (A and B).

import { randomUUID } from "crypto";

// ── Request: Anthropic body → OpenAI body ─────────────────────────────────────

interface AnthropicMessage {
  role:    string;
  content: any;
}

interface OpenAIMessage {
  role:           string;
  content:        any;
  tool_calls?:    any[];
  tool_call_id?:  string;
}

function anthropicContentToText(content: any): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b: any) => b?.type === "text")
    .map((b: any) => b.text || "")
    .join("");
}

// Anthropic tool_result.content may be a string or an array of content blocks.
function anthropicToolResultToText(content: any): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b: any) => (typeof b === "string" ? b : b?.type === "text" ? b.text || "" : ""))
      .join("");
  }
  return "";
}

// Anthropic tools (input_schema) → OpenAI tools (function.parameters).
function anthropicToolsToOpenAi(tools: any[]): any[] {
  return tools
    .filter((t: any) => t?.name)
    .map((t: any) => ({
      type: "function",
      function: {
        name:        t.name,
        description: t.description || "",
        parameters:  t.input_schema || { type: "object", properties: {} },
      },
    }));
}

// Anthropic tool_choice → OpenAI tool_choice.
function anthropicToolChoiceToOpenAi(tc: any): any | undefined {
  if (!tc) return undefined;
  if (tc.type === "auto") return "auto";
  if (tc.type === "any")  return "required";
  if (tc.type === "none") return "none";
  if (tc.type === "tool" && tc.name) return { type: "function", function: { name: tc.name } };
  return undefined;
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
    const blocks = Array.isArray(m.content) ? m.content : null;

    if (m.role === "assistant") {
      const text      = anthropicContentToText(m.content);
      const toolUses  = blocks ? blocks.filter((b: any) => b?.type === "tool_use") : [];
      if (toolUses.length > 0) {
        messages.push({
          role:    "assistant",
          content: text || null,
          tool_calls: toolUses.map((b: any) => ({
            id:   b.id || "",
            type: "function",
            function: { name: b.name || "", arguments: JSON.stringify(b.input ?? {}) },
          })),
        });
      } else if (text) {
        messages.push({ role: "assistant", content: text });
      }
      continue;
    }

    // user role — may carry tool_result blocks (OpenAI expects role:"tool" per result)
    const toolResults = blocks ? blocks.filter((b: any) => b?.type === "tool_result") : [];
    if (toolResults.length > 0) {
      for (const tr of toolResults) {
        messages.push({
          role:         "tool",
          tool_call_id: tr.tool_use_id || "",
          content:      anthropicToolResultToText(tr.content),
        });
      }
      const text = anthropicContentToText(m.content);
      if (text) messages.push({ role: "user", content: text });
      continue;
    }

    const text = anthropicContentToText(m.content);
    if (text) messages.push({ role: "user", content: text });
  }

  const out: any = {
    model:        providerModel,
    messages,
    max_tokens:   body.max_tokens || 4096,
    stream:       !!body.stream,
  };
  if (typeof body.temperature === "number") out.temperature = body.temperature;
  if (typeof body.top_p === "number")        out.top_p       = body.top_p;

  const tools = Array.isArray(body.tools) ? anthropicToolsToOpenAi(body.tools) : [];
  if (tools.length) {
    out.tools = tools;
    const tc = anthropicToolChoiceToOpenAi(body.tool_choice);
    if (tc !== undefined) out.tool_choice = tc;
  }
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

  const content: any[] = [];
  if (text) content.push({ type: "text", text });
  const toolCalls = Array.isArray(choice?.message?.tool_calls) ? choice.message.tool_calls : [];
  for (const tc of toolCalls) {
    let input: any = {};
    try { input = JSON.parse(tc.function?.arguments || "{}"); } catch {}
    content.push({ type: "tool_use", id: tc.id || "", name: tc.function?.name || "", input });
  }

  return {
    id:           "msg_" + randomUUID().replace(/-/g, "").slice(0, 24),
    type:         "message",
    role:         "assistant",
    model:        originalModel,
    content,
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
  emittedBlock:   boolean;       // text block (index 0) opened
  finishReason:   string;
  nextBlockIndex: number;        // next Anthropic content block index to assign
  textBlockIndex: number | null; // assigned index of the text block, if any
  toolBlocks:     Map<number, number>; // OpenAI tool_call index → Anthropic block index
  openBlocks:     Set<number>;   // block indices opened but not yet stopped
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

function emitContentBlockStart(index = 0): string {
  return sseEvent("content_block_start", {
    type: "content_block_start",
    index,
    content_block: { type: "text", text: "" },
  });
}

function emitContentBlockDelta(text: string, index = 0): string {
  return sseEvent("content_block_delta", {
    type: "content_block_delta",
    index,
    delta: { type: "text_delta", text },
  });
}

function emitContentBlockStop(index = 0): string {
  return sseEvent("content_block_stop", { type: "content_block_stop", index });
}

// Tool block (Anthropic tool_use) — opened from OpenAI delta.tool_calls header.
function emitToolBlockStart(index: number, id: string, name: string): string {
  return sseEvent("content_block_start", {
    type: "content_block_start",
    index,
    content_block: { type: "tool_use", id, name, input: {} },
  });
}

// Incremental tool arguments — Anthropic input_json_delta carries partial JSON.
function emitToolBlockDelta(index: number, partialJson: string): string {
  return sseEvent("content_block_delta", {
    type: "content_block_delta",
    index,
    delta: { type: "input_json_delta", partial_json: partialJson },
  });
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

function emitErrorEvent(message: string): string {
  return sseEvent("error", { type: "error", error: { type: "api_error", message } });
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
      let failed = false;
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
      } catch (e) {
        // Source aborted mid-stream. Closing here would synthesize a [DONE] the
        // upstream never sent — the client would read a truncated answer as complete.
        failed = true;
        controller.error(e);
        reader.cancel(e).catch(() => {});
      } finally {
        if (!failed) {
          if (!emittedRole) {
            controller.enqueue(encoder.encode(oaiChunk({ role: "assistant", content: "" }, null)));
            controller.enqueue(encoder.encode(oaiChunk({}, "stop")));
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          }
          controller.close();
        }
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
        nextBlockIndex: 0,
        textBlockIndex: null,
        toolBlocks:   new Map(),
        openBlocks:   new Set(),
      };

      // Anthropic requires one content block open at a time, closed in order.
      // OpenAI streams text then tool_calls (each by index) — close the prior
      // block before opening the next so pairing stays valid.
      const closeOpenBlocks = () => {
        for (const idx of state.openBlocks) {
          controller.enqueue(encoder.encode(emitContentBlockStop(idx)));
        }
        state.openBlocks.clear();
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

              // Final usage if upstream provides it — often arrives in a chunk with
              // empty `choices` (e.g. qwen), so capture it before the choice guard.
              if (parsed?.usage?.completion_tokens) state.outputTokens = parsed.usage.completion_tokens;
              if (parsed?.usage?.prompt_tokens)     state.inputTokens  = parsed.usage.prompt_tokens;

              const choice = parsed?.choices?.[0];
              if (!choice) continue;

              // Text content delta — open text block on first appearance
              const delta = choice.delta?.content;
              if (delta) {
                if (state.textBlockIndex === null) {
                  closeOpenBlocks();
                  state.textBlockIndex = state.nextBlockIndex++;
                  state.emittedBlock = true;
                  state.openBlocks.add(state.textBlockIndex);
                  controller.enqueue(encoder.encode(emitContentBlockStart(state.textBlockIndex)));
                }
                state.outputTokens++; // rough estimate per delta
                controller.enqueue(encoder.encode(emitContentBlockDelta(delta, state.textBlockIndex)));
              }

              // Tool call deltas — header (id+name) then incremental arguments
              const toolCalls = choice.delta?.tool_calls;
              if (Array.isArray(toolCalls)) {
                for (const tc of toolCalls) {
                  const oaiIdx = typeof tc.index === "number" ? tc.index : 0;
                  let blockIdx = state.toolBlocks.get(oaiIdx);
                  if (blockIdx === undefined) {
                    // New tool call — close prior block, open a tool_use block
                    closeOpenBlocks();
                    blockIdx = state.nextBlockIndex++;
                    state.toolBlocks.set(oaiIdx, blockIdx);
                    state.openBlocks.add(blockIdx);
                    const id   = tc.id || ("toolu_" + randomUUID().replace(/-/g, "").slice(0, 20));
                    const name = tc.function?.name || "";
                    controller.enqueue(encoder.encode(emitToolBlockStart(blockIdx, id, name)));
                  }
                  const args = tc.function?.arguments;
                  if (args) {
                    controller.enqueue(encoder.encode(emitToolBlockDelta(blockIdx, args)));
                  }
                }
              }

              if (choice.finish_reason) {
                state.finishReason = choice.finish_reason;
              }
            }
          }
        }
      } finally {
        // Always emit closing events
        closeOpenBlocks();
        // Some providers (e.g. qwen free tier) reply 200 + finish "stop" with zero
        // content when the input exceeds their context limit. Surface that as an
        // explicit error event instead of an empty-but-successful-looking response.
        if (state.textBlockIndex === null && state.toolBlocks.size === 0) {
          controller.enqueue(encoder.encode(emitErrorEvent(
            `Upstream returned an empty completion (0 output tokens${state.inputTokens ? `, input ${state.inputTokens} tokens` : ""}). ` +
            `The input likely exceeds the provider's context limit.`,
          )));
        } else if (state.emittedStart) {
          controller.enqueue(encoder.encode(emitMessageDelta(state)));
          controller.enqueue(encoder.encode(emitMessageStop()));
        }
        controller.close();
      }
    },
  });
}
