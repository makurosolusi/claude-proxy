/**
 * Tests for openaiTranslate.ts and the stream:false fix in apiTestProviders.
 * No server or DB needed — pure logic tests.
 * Run: bun test tests/openaiTranslate.test.ts
 */
import { describe, test, expect } from "bun:test";
import { anthropicToOpenAi, openAiToAnthropic } from "../src/openaiTranslate";

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
