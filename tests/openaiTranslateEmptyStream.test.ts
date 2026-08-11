/**
 * Guard: upstream OpenAI-like yang balas 200 + finish "stop" tanpa konten
 * (mis. qwen free tier saat input melebihi context limit) harus di-surface
 * sebagai SSE `error` event, bukan stream kosong yang tampak sukses.
 * Run: bun test tests/openaiTranslateEmptyStream.test.ts
 */
import { describe, test, expect } from "bun:test";
import { translateOpenAiStreamToAnthropic } from "../src/openaiTranslate";

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

async function drainAnthropicSse(stream: ReadableStream<Uint8Array>): Promise<any[]> {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
  }
  const events: any[] = [];
  for (const block of buf.split("\n\n")) {
    const dataLine = block.split("\n").find(l => l.startsWith("data:"));
    if (!dataLine) continue;
    const payload = dataLine.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try { events.push(JSON.parse(payload)); } catch {}
  }
  return events;
}

describe("translateOpenAiStreamToAnthropic — empty completion guard", () => {
  test("finish stop tanpa konten → error event dengan input tokens", async () => {
    const out = translateOpenAiStreamToAnthropic(openAiSseStream([
      { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
      { choices: [], usage: { prompt_tokens: 61368, completion_tokens: 0, total_tokens: 61368 } },
    ]), "claude-opus-5");
    const events = await drainAnthropicSse(out);
    const err = events.find(e => e.type === "error");
    expect(err).toBeDefined();
    expect(err.error.type).toBe("api_error");
    expect(err.error.message).toContain("empty completion");
    expect(err.error.message).toContain("61368");
    expect(events.find(e => e.type === "message_stop")).toBeUndefined();
  });

  test("upstream tanpa chunk sama sekali → error event", async () => {
    const out = translateOpenAiStreamToAnthropic(openAiSseStream([]), "m");
    const events = await drainAnthropicSse(out);
    expect(events.length).toBe(1);
    expect(events[0].type).toBe("error");
  });

  test("respons text normal → tidak ada error event", async () => {
    const out = translateOpenAiStreamToAnthropic(openAiSseStream([
      { choices: [{ index: 0, delta: { content: "halo" }, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    ]), "m");
    const events = await drainAnthropicSse(out);
    expect(events.find(e => e.type === "error")).toBeUndefined();
    expect(events.find(e => e.type === "message_stop")).toBeDefined();
  });

  test("respons tool-only (tanpa text) → tidak dianggap kosong", async () => {
    const out = translateOpenAiStreamToAnthropic(openAiSseStream([
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "Bash", arguments: "" } }] }, finish_reason: null }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: "{\"command\":\"ls\"}" } }] }, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
    ]), "m");
    const events = await drainAnthropicSse(out);
    expect(events.find(e => e.type === "error")).toBeUndefined();
    const stop = events.find(e => e.type === "message_delta");
    expect(stop.delta.stop_reason).toBe("tool_use");
  });
});
