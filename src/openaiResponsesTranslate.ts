// Translates between OpenAI Responses API (/v1/responses) and Anthropic Messages API.

function genId(prefix: string): string {
  return prefix + Math.random().toString(36).slice(2, 9) + Math.random().toString(36).slice(2, 9);
}

// ── Input: Responses API body → Anthropic body ───────────────────────────────

export function responsesInputToAnthropic(body: any): any {
  const input: any[] = typeof body.input === "string"
    ? [{ role: "user", content: body.input }]
    : Array.isArray(body.input) ? body.input : [];

  const preliminary: any[] = [];
  for (const item of input) {
    if (item.type === "function_call_output") {
      preliminary.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: item.call_id, content: item.output ?? "" }],
      });
      continue;
    }
    const role = item.role as string;
    if (role === "system") continue;
    if (role === "user") {
      const c = item.content;
      preliminary.push({
        role: "user",
        content: typeof c === "string" ? c
          : Array.isArray(c)
            ? c.filter((b: any) => b.type === "input_text" || b.type === "text").map((b: any) => b.text || "").join("")
              || c.map((b: any) => b.text || "").join("")
          : "",
      });
      continue;
    }
    if (role === "assistant") {
      const c = item.content;
      const parts: any[] = typeof c === "string"
        ? [{ type: "output_text", text: c }]
        : Array.isArray(c) ? c : [];
      const blocks: any[] = [];
      for (const p of parts) {
        if (p.type === "output_text" || p.type === "text") {
          if (p.text) blocks.push({ type: "text", text: p.text });
        } else if (p.type === "function_call") {
          let inp: any = {};
          try { inp = JSON.parse(p.arguments || "{}"); } catch {}
          blocks.push({ type: "tool_use", id: p.call_id || genId("toolu_"), name: p.name, input: inp });
        }
      }
      if (blocks.length > 0) preliminary.push({ role: "assistant", content: blocks });
      continue;
    }
  }

  // Merge consecutive user messages that are all tool_results (parallel tool calls)
  const messages: any[] = [];
  for (const m of preliminary) {
    const prev = messages[messages.length - 1];
    if (prev?.role === "user" && isAllToolResults(prev) && isAllToolResults(m)) {
      prev.content = [...prev.content, ...(m.content as any[])];
    } else {
      messages.push(m);
    }
  }

  const out: any = {
    model: body.model || "claude-sonnet-4-6",
    messages,
    max_tokens: body.max_output_tokens || 4096,
    stream: body.stream ?? false,
  };
  if (body.instructions)              out.system = body.instructions;
  if (typeof body.temperature === "number") out.temperature = body.temperature;
  if (typeof body.top_p      === "number") out.top_p       = body.top_p;
  if (Array.isArray(body.tools) && body.tools.length > 0) {
    out.tools = body.tools.map((t: any) => ({
      name:         t.name         || "",
      description:  t.description  || "",
      input_schema: t.parameters   || { type: "object", properties: {} },
    }));
    const tc = body.tool_choice;
    if (tc) {
      if      (tc === "auto")          out.tool_choice = { type: "auto" };
      else if (tc === "none")          out.tool_choice = { type: "none" };
      else if (tc === "required")      out.tool_choice = { type: "any"  };
      else if (tc?.type === "function") out.tool_choice = { type: "tool", name: tc.name };
    }
  }
  return out;
}

function isAllToolResults(m: any): boolean {
  return Array.isArray(m.content) && m.content.every((b: any) => b.type === "tool_result");
}

// ── Non-streaming: Anthropic response → Responses API response ───────────────

export function anthropicToResponsesOutput(anthr: any, model: string): any {
  const output: any[] = [];
  const content: any[] = anthr.content || [];

  const textBlocks = content.filter((b: any) => b.type === "text");
  const toolBlocks = content.filter((b: any) => b.type === "tool_use");

  if (textBlocks.length > 0) {
    output.push({
      id: genId("msg_"), type: "message", role: "assistant", status: "completed",
      content: textBlocks.map((b: any) => ({ type: "output_text", text: b.text || "" })),
    });
  }
  for (const b of toolBlocks) {
    output.push({
      id: genId("fc_"), type: "function_call",
      call_id: b.id, name: b.name,
      arguments: JSON.stringify(b.input ?? {}),
      status: "completed",
    });
  }

  return {
    id:         genId("resp_"),
    object:     "response",
    created_at: Math.floor(Date.now() / 1000),
    model:      model || anthr.model || "",
    status:     "completed",
    output,
    usage: {
      input_tokens:  anthr.usage?.input_tokens  ?? 0,
      output_tokens: anthr.usage?.output_tokens ?? 0,
      total_tokens:  (anthr.usage?.input_tokens ?? 0) + (anthr.usage?.output_tokens ?? 0),
    },
  };
}

// ── Streaming: Anthropic SSE → Responses API SSE ─────────────────────────────

interface BlockState {
  type: "text" | "tool_use";
  outputIndex: number;
  contentIndex: number;
  itemId: string;
  callId: string;
  name: string;
  accumText: string;
  accumArgs: string;
}

export function translateAnthropicStreamToResponses(
  upstream: ReadableStream<Uint8Array>,
  model: string,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  return new ReadableStream({
    start(controller) {
      const emit = (event: string, data: any) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

      const responseId   = genId("resp_");
      const msgItemId    = genId("msg_");
      const createdAt    = Math.floor(Date.now() / 1000);
      const blocks       = new Map<number, BlockState>();
      let nextOutputIndex    = 0;
      let msgOutputIndex     = -1;
      let msgContentIndex    = 0;
      let msgItemOpen        = false;
      let inputTokens        = 0;
      let outputTokens       = 0;

      function closeMsgItem() {
        if (!msgItemOpen) return;
        msgItemOpen = false;
        const textParts = [...blocks.values()]
          .filter(b => b.type === "text")
          .map(b => ({ type: "output_text", text: b.accumText }));
        emit("response.output_item.done", {
          type: "response.output_item.done", output_index: msgOutputIndex,
          item: { id: msgItemId, type: "message", role: "assistant", status: "completed", content: textParts },
        });
      }

      function processLine(raw: string) {
        if (!raw.startsWith("data: ") || raw === "data: [DONE]") return;
        let ev: any;
        try { ev = JSON.parse(raw.slice(6)); } catch { return; }

        if (ev.type === "message_start") {
          inputTokens = ev.message?.usage?.input_tokens ?? 0;
          emit("response.created", {
            type: "response.created",
            response: { id: responseId, object: "response", created_at: createdAt, status: "in_progress", model: ev.message?.model || model, output: [] },
          });
          return;
        }

        if (ev.type === "message_delta") {
          outputTokens = ev.usage?.output_tokens ?? outputTokens;
          return;
        }

        if (ev.type === "message_stop") {
          closeMsgItem();
          const allBlocks = [...blocks.values()];
          const output: any[] = [];
          if (msgOutputIndex >= 0) {
            output[msgOutputIndex] = {
              id: msgItemId, type: "message", role: "assistant", status: "completed",
              content: allBlocks.filter(b => b.type === "text").map(b => ({ type: "output_text", text: b.accumText })),
            };
          }
          for (const b of allBlocks.filter(b => b.type === "tool_use")) {
            output[b.outputIndex] = { id: b.itemId, type: "function_call", call_id: b.callId, name: b.name, arguments: b.accumArgs, status: "completed" };
          }
          emit("response.completed", {
            type: "response.completed",
            response: {
              id: responseId, object: "response", created_at: createdAt, model, status: "completed",
              output: output.filter(Boolean),
              usage: { input_tokens: inputTokens, output_tokens: outputTokens, total_tokens: inputTokens + outputTokens },
            },
          });
          controller.close();
          return;
        }

        if (ev.type === "content_block_start") {
          const idx = ev.index as number;
          const cb  = ev.content_block;
          if (cb.type === "text") {
            if (msgOutputIndex < 0) {
              msgOutputIndex = nextOutputIndex++;
              msgItemOpen    = true;
              emit("response.output_item.added", {
                type: "response.output_item.added", output_index: msgOutputIndex,
                item: { id: msgItemId, type: "message", role: "assistant", status: "in_progress", content: [] },
              });
            }
            const ci = msgContentIndex++;
            blocks.set(idx, { type: "text", outputIndex: msgOutputIndex, contentIndex: ci, itemId: msgItemId, callId: "", name: "", accumText: "", accumArgs: "" });
            emit("response.content_part.added", {
              type: "response.content_part.added", item_id: msgItemId,
              output_index: msgOutputIndex, content_index: ci, part: { type: "output_text", text: "" },
            });
          } else if (cb.type === "tool_use") {
            closeMsgItem();
            const fcId = genId("fc_");
            const oi   = nextOutputIndex++;
            blocks.set(idx, { type: "tool_use", outputIndex: oi, contentIndex: 0, itemId: fcId, callId: cb.id, name: cb.name, accumText: "", accumArgs: "" });
            emit("response.output_item.added", {
              type: "response.output_item.added", output_index: oi,
              item: { id: fcId, type: "function_call", call_id: cb.id, name: cb.name, arguments: "", status: "in_progress" },
            });
          }
          return;
        }

        if (ev.type === "content_block_delta") {
          const b = blocks.get(ev.index as number);
          if (!b) return;
          if (ev.delta?.type === "text_delta") {
            const text = ev.delta.text || "";
            b.accumText += text;
            emit("response.output_text.delta", {
              type: "response.output_text.delta", item_id: b.itemId,
              output_index: b.outputIndex, content_index: b.contentIndex, delta: text,
            });
          } else if (ev.delta?.type === "input_json_delta") {
            const partial = ev.delta.partial_json || "";
            b.accumArgs += partial;
            emit("response.function_call_arguments.delta", {
              type: "response.function_call_arguments.delta", item_id: b.itemId,
              output_index: b.outputIndex, delta: partial,
            });
          }
          return;
        }

        if (ev.type === "content_block_stop") {
          const b = blocks.get(ev.index as number);
          if (!b) return;
          if (b.type === "text") {
            emit("response.output_text.done", {
              type: "response.output_text.done", item_id: b.itemId,
              output_index: b.outputIndex, content_index: b.contentIndex, text: b.accumText,
            });
            emit("response.content_part.done", {
              type: "response.content_part.done", item_id: b.itemId,
              output_index: b.outputIndex, content_index: b.contentIndex,
              part: { type: "output_text", text: b.accumText },
            });
            // output_item.done deferred to closeMsgItem() — fired when tool_use starts or message_stop
          } else {
            emit("response.function_call_arguments.done", {
              type: "response.function_call_arguments.done", item_id: b.itemId,
              output_index: b.outputIndex, arguments: b.accumArgs,
            });
            emit("response.output_item.done", {
              type: "response.output_item.done", output_index: b.outputIndex,
              item: { id: b.itemId, type: "function_call", call_id: b.callId, name: b.name, arguments: b.accumArgs, status: "completed" },
            });
          }
        }
      }

      const reader = upstream.getReader();
      let buffer = "";
      (async () => {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) processLine(line.trimEnd());
          }
          if (buffer) processLine(buffer.trimEnd());
        } catch (e) { controller.error(e); }
        finally { reader.releaseLock(); }
      })();
    },
  });
}
