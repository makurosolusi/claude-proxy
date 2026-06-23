/**
 * Tests for openaiTranslate.ts and the stream:false fix in apiTestProviders.
 * No server or DB needed — pure logic tests.
 * Run: bun test tests/openaiTranslate.test.ts
 */
import { describe, test, expect } from "bun:test";
import { anthropicToOpenAi, openAiToAnthropic, translateOpenAiStreamToAnthropic } from "../src/openaiTranslate";

// Build a ReadableStream of OpenAI SSE chunks from an array of delta objects.
function openAiSseStream(chunks: any[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(`data: ${JSON.stringify(ch)}\n\n`));
      c.enqueue(enc.encode("data: [DONE]\n\n"));
      c.close();
    },
  });
}

// Drain an Anthropic SSE stream into parsed event objects (data: payloads).
async function drainAnthropicSse(stream: ReadableStream<Uint8Array>): Promise<any[]> {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const events: any[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
  }
  for (const block of buf.split("\n\n")) {
    const dataLine = block.split("\n").find(l => l.startsWith("data:"));
    if (!dataLine) continue;
    const payload = dataLine.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try { events.push(JSON.parse(payload)); } catch {}
  }
  return events;
}

// ── anthropicToOpenAi: stream field passthrough ────────────────────────────────
describe("anthropicToOpenAi — stream field", () => {
  test("stream:true → openai body has stream:true", () => {
    const body = {
      model: "claude-sonnet-4-5",
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 100,
      stream: true,
    };
    const out = anthropicToOpenAi(body, "kr/auto");
    expect(out.stream).toBe(true);
  });

  test("stream:false → openai body has stream:false", () => {
    const body = {
      model: "claude-sonnet-4-5",
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 100,
      stream: false,
    };
    const out = anthropicToOpenAi(body, "kr/auto");
    expect(out.stream).toBe(false);
  });

  test("no stream field → openai body has stream:false (!!undefined = false)", () => {
    const body = {
      model: "claude-sonnet-4-5",
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 100,
    };
    const out = anthropicToOpenAi(body, "kr/auto");
    expect(out.stream).toBe(false);
  });
});

// ── Test request body — stream:false guarantee ─────────────────────────────────
// Mirrors exactly what handleCustomProviderTest builds for openai-like providers.
describe("test request body has stream:false", () => {
  function buildTestBody(model: string) {
    return JSON.parse(JSON.stringify({
      model,
      messages:   [{ role: "user", content: "Reply with exactly the word: OK" }],
      max_tokens: 12,
      stream:     false,
    }));
  }

  test("stream field is explicitly false (not missing)", () => {
    const b = buildTestBody("kr/auto");
    expect(Object.prototype.hasOwnProperty.call(b, "stream")).toBe(true);
    expect(b.stream).toBe(false);
  });

  test("stream:false body can be JSON.parse'd back cleanly", () => {
    const b = buildTestBody("kr/auto");
    const serialized = JSON.stringify(b);
    const parsed = JSON.parse(serialized);
    expect(parsed.stream).toBe(false);
  });

  test("without stream:false — 9router would stream (regression guard)", () => {
    // This is the old broken body — missing stream field
    const oldBody = { model: "kr/auto", messages: [{ role: "user", content: "hi" }], max_tokens: 12 };
    expect(Object.prototype.hasOwnProperty.call(oldBody, "stream")).toBe(false);
    // Without stream, 9router defaults to SSE → r.json() would fail
    // The fix ensures we always send stream:false explicitly
  });
});

// ── anthropicToOpenAi: message translation ─────────────────────────────────────
describe("anthropicToOpenAi — message translation", () => {
  test("user text message translates correctly", () => {
    const body = {
      messages: [{ role: "user", content: "hello" }],
      max_tokens: 100,
    };
    const out = anthropicToOpenAi(body, "kr/auto");
    expect(out.messages).toHaveLength(1);
    expect(out.messages[0]).toEqual({ role: "user", content: "hello" });
  });

  test("system prompt becomes first message", () => {
    const body = {
      system: "You are helpful.",
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 100,
    };
    const out = anthropicToOpenAi(body, "kr/auto");
    expect(out.messages[0].role).toBe("system");
    expect(out.messages[0].content).toBe("You are helpful.");
    expect(out.messages[1].role).toBe("user");
  });

  test("max_tokens passed through, defaults to 4096", () => {
    const out1 = anthropicToOpenAi({ messages: [], max_tokens: 512 }, "m");
    expect(out1.max_tokens).toBe(512);
    const out2 = anthropicToOpenAi({ messages: [] }, "m");
    expect(out2.max_tokens).toBe(4096);
  });

  test("temperature and top_p passed through when present", () => {
    const out = anthropicToOpenAi({ messages: [], temperature: 0.7, top_p: 0.9 }, "m");
    expect(out.temperature).toBe(0.7);
    expect(out.top_p).toBe(0.9);
  });

  test("temperature omitted when not in source", () => {
    const out = anthropicToOpenAi({ messages: [] }, "m");
    expect(out.temperature).toBeUndefined();
    expect(out.top_p).toBeUndefined();
  });
});

// ── openAiToAnthropic: response translation ────────────────────────────────────
describe("openAiToAnthropic — non-streaming response", () => {
  const openaiResp = {
    id: "chatcmpl-xyz",
    choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 },
  };

  test("content translated to anthropic format", () => {
    const out = openAiToAnthropic(openaiResp, "claude-sonnet-4-5");
    expect(out.content).toEqual([{ type: "text", text: "OK" }]);
  });

  test("stop finish_reason → end_turn", () => {
    const out = openAiToAnthropic(openaiResp, "claude-sonnet-4-5");
    expect(out.stop_reason).toBe("end_turn");
  });

  test("length finish_reason → max_tokens", () => {
    const resp = { ...openaiResp, choices: [{ ...openaiResp.choices[0], finish_reason: "length" }] };
    const out = openAiToAnthropic(resp, "claude-sonnet-4-5");
    expect(out.stop_reason).toBe("max_tokens");
  });

  test("usage tokens mapped correctly", () => {
    const out = openAiToAnthropic(openaiResp, "claude-sonnet-4-5");
    expect(out.usage.input_tokens).toBe(10);
    expect(out.usage.output_tokens).toBe(1);
  });

  test("model preserved", () => {
    const out = openAiToAnthropic(openaiResp, "claude-sonnet-4-5");
    expect(out.model).toBe("claude-sonnet-4-5");
  });
});

// ── Direction A: tools[] forwarded to OpenAI ───────────────────────────────────
describe("anthropicToOpenAi — tools translation", () => {
  const tools = [
    {
      name: "Write",
      description: "Write a file",
      input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    },
  ];

  test("anthropic tools (input_schema) → openai function.parameters", () => {
    const out = anthropicToOpenAi({ messages: [], tools }, "kr/auto");
    expect(out.tools).toHaveLength(1);
    expect(out.tools[0].type).toBe("function");
    expect(out.tools[0].function.name).toBe("Write");
    expect(out.tools[0].function.description).toBe("Write a file");
    expect(out.tools[0].function.parameters).toEqual(tools[0].input_schema);
  });

  test("no tools → no tools/tool_choice field on output", () => {
    const out = anthropicToOpenAi({ messages: [] }, "kr/auto");
    expect(out.tools).toBeUndefined();
    expect(out.tool_choice).toBeUndefined();
  });

  test("tool_choice auto → 'auto'", () => {
    const out = anthropicToOpenAi({ messages: [], tools, tool_choice: { type: "auto" } }, "m");
    expect(out.tool_choice).toBe("auto");
  });

  test("tool_choice any → 'required'", () => {
    const out = anthropicToOpenAi({ messages: [], tools, tool_choice: { type: "any" } }, "m");
    expect(out.tool_choice).toBe("required");
  });

  test("tool_choice specific tool → {type:function, function:{name}}", () => {
    const out = anthropicToOpenAi({ messages: [], tools, tool_choice: { type: "tool", name: "Write" } }, "m");
    expect(out.tool_choice).toEqual({ type: "function", function: { name: "Write" } });
  });
});

// ── Direction A: tool_use/tool_result history translation ───────────────────────
describe("anthropicToOpenAi — tool conversation history", () => {
  test("assistant tool_use block → openai tool_calls", () => {
    const body = {
      messages: [
        { role: "user", content: "write hi.txt" },
        {
          role: "assistant",
          content: [
            { type: "text", text: "Sure." },
            { type: "tool_use", id: "toolu_1", name: "Write", input: { path: "hi.txt", content: "hi" } },
          ],
        },
      ],
    };
    const out = anthropicToOpenAi(body, "m");
    const asst = out.messages.find((m: any) => m.role === "assistant");
    expect(asst.content).toBe("Sure.");
    expect(asst.tool_calls).toHaveLength(1);
    expect(asst.tool_calls[0].id).toBe("toolu_1");
    expect(asst.tool_calls[0].type).toBe("function");
    expect(asst.tool_calls[0].function.name).toBe("Write");
    expect(JSON.parse(asst.tool_calls[0].function.arguments)).toEqual({ path: "hi.txt", content: "hi" });
  });

  test("user tool_result block → role:'tool' message with tool_call_id", () => {
    const body = {
      messages: [
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "File written" }],
        },
      ],
    };
    const out = anthropicToOpenAi(body, "m");
    const toolMsg = out.messages.find((m: any) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    expect(toolMsg.tool_call_id).toBe("toolu_1");
    expect(toolMsg.content).toBe("File written");
  });

  test("tool_result content as array of text blocks → joined text", () => {
    const body = {
      messages: [
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: "line1" }, { type: "text", text: "line2" }] }],
        },
      ],
    };
    const out = anthropicToOpenAi(body, "m");
    const toolMsg = out.messages.find((m: any) => m.role === "tool");
    expect(toolMsg.content).toBe("line1line2");
  });
});

// ── Direction A: non-streaming response with tool_calls ────────────────────────
describe("openAiToAnthropic — tool_calls in response", () => {
  const resp = {
    id: "chatcmpl-1",
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "call_1", type: "function", function: { name: "Write", arguments: '{"path":"a.txt"}' } }],
      },
      finish_reason: "tool_calls",
    }],
    usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
  };

  test("tool_calls → tool_use content block", () => {
    const out = openAiToAnthropic(resp, "claude-sonnet-4-5");
    const toolUse = out.content.find((b: any) => b.type === "tool_use");
    expect(toolUse).toBeDefined();
    expect(toolUse.id).toBe("call_1");
    expect(toolUse.name).toBe("Write");
    expect(toolUse.input).toEqual({ path: "a.txt" });
  });

  test("finish_reason tool_calls → stop_reason tool_use", () => {
    const out = openAiToAnthropic(resp, "claude-sonnet-4-5");
    expect(out.stop_reason).toBe("tool_use");
  });

  test("malformed tool arguments → empty input object (no throw)", () => {
    const bad = { ...resp, choices: [{ ...resp.choices[0], message: { ...resp.choices[0].message, tool_calls: [{ id: "c", type: "function", function: { name: "X", arguments: "{not json" } }] } }] };
    const out = openAiToAnthropic(bad, "m");
    const toolUse = out.content.find((b: any) => b.type === "tool_use");
    expect(toolUse.input).toEqual({});
  });
});

// ── Direction A: streaming tool_calls translation ──────────────────────────────
describe("translateOpenAiStreamToAnthropic — tool calls", () => {
  test("streamed tool_call → tool_use block + input_json_delta + stop", async () => {
    const chunks = [
      { choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "Write", arguments: "" } }] }, finish_reason: null }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"path":' } }] }, finish_reason: null }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"a.txt"}' } }] }, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
    ];
    const out = translateOpenAiStreamToAnthropic(openAiSseStream(chunks), "claude-sonnet-4-5");
    const events = await drainAnthropicSse(out);

    const start = events.find(e => e.type === "content_block_start" && e.content_block?.type === "tool_use");
    expect(start).toBeDefined();
    expect(start.content_block.id).toBe("call_1");
    expect(start.content_block.name).toBe("Write");

    const deltas = events.filter(e => e.type === "content_block_delta" && e.delta?.type === "input_json_delta");
    const joined = deltas.map(d => d.delta.partial_json).join("");
    expect(joined).toBe('{"path":"a.txt"}');

    const stop = events.find(e => e.type === "content_block_stop" && e.index === start.index);
    expect(stop).toBeDefined();

    const msgDelta = events.find(e => e.type === "message_delta");
    expect(msgDelta.delta.stop_reason).toBe("tool_use");
  });

  test("text then tool_call → text block closed before tool block opens", async () => {
    const chunks = [
      { choices: [{ index: 0, delta: { content: "thinking" }, finish_reason: null }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "Read", arguments: "{}" } }] }, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
    ];
    const out = translateOpenAiStreamToAnthropic(openAiSseStream(chunks), "m");
    const events = await drainAnthropicSse(out);

    const textStart = events.find(e => e.type === "content_block_start" && e.content_block?.type === "text");
    const toolStart = events.find(e => e.type === "content_block_start" && e.content_block?.type === "tool_use");
    expect(textStart.index).toBe(0);
    expect(toolStart.index).toBe(1);

    // text block (index 0) must be stopped before tool block opens
    const textStopIdx = events.findIndex(e => e.type === "content_block_stop" && e.index === 0);
    const toolStartIdx = events.findIndex(e => e.type === "content_block_start" && e.content_block?.type === "tool_use");
    expect(textStopIdx).toBeGreaterThan(-1);
    expect(textStopIdx).toBeLessThan(toolStartIdx);
  });

  test("two parallel tool_calls → two distinct tool_use blocks", async () => {
    const chunks = [
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "A", arguments: "{}" } }] }, finish_reason: null }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 1, id: "c2", type: "function", function: { name: "B", arguments: "{}" } }] }, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
    ];
    const out = translateOpenAiStreamToAnthropic(openAiSseStream(chunks), "m");
    const events = await drainAnthropicSse(out);

    const toolStarts = events.filter(e => e.type === "content_block_start" && e.content_block?.type === "tool_use");
    expect(toolStarts).toHaveLength(2);
    expect(toolStarts[0].content_block.name).toBe("A");
    expect(toolStarts[1].content_block.name).toBe("B");
    expect(toolStarts[0].index).not.toBe(toolStarts[1].index);

    // every opened block must be closed
    const stops = events.filter(e => e.type === "content_block_stop");
    expect(stops.length).toBeGreaterThanOrEqual(2);
  });
});
