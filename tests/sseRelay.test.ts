/**
 * Tests for sseRelay.ts — no server needed
 * Run: bun test tests/sseRelay.test.ts
 */
import { describe, test, expect } from "bun:test";
import { relaySse } from "../src/sseRelay";

const enc = new TextEncoder();

/** Socket-like body: hands out one chunk per pull, then ends or errors. */
function body(chunks: string[], failWith?: string): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (i < chunks.length) return void c.enqueue(enc.encode(chunks[i++]));
      if (failWith) c.error(new Error(failWith));
      else c.close();
    },
  });
}

/** Read a stream to the end, recording whether it ended cleanly or errored. */
async function drain(rs: ReadableStream<Uint8Array>) {
  const reader = rs.getReader();
  const dec = new TextDecoder();
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      text += dec.decode(value, { stream: true });
    }
    return { text, error: null as string | null };
  } catch (e: any) {
    return { text, error: e?.message ?? String(e) };
  }
}

const passthrough = (line: string) => [line + "\n"];

describe("relaySse — golden path", () => {
  test("relays every line and ends the readable cleanly", async () => {
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const [outcome, drained] = await Promise.all([
      relaySse(body(["event: a\ndata: 1\n", "\nevent: b\ndata: 2\n\n"]), writable.getWriter(), passthrough),
      drain(readable),
    ]);
    expect(outcome).toEqual({ ok: true });
    expect(drained.error).toBeNull();
    expect(drained.text).toBe("event: a\ndata: 1\n\nevent: b\ndata: 2\n\n");
  });

  test("transform can expand one line into several chunks (announcement injection)", async () => {
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const [outcome, drained] = await Promise.all([
      relaySse(body(["data: start\n"]), writable.getWriter(),
        line => [line + "\n", "event: injected\ndata: {}\n\n"]),
      drain(readable),
    ]);
    expect(outcome).toEqual({ ok: true });
    expect(drained.text).toBe("data: start\nevent: injected\ndata: {}\n\n");
  });
});

describe("relaySse — failure modes", () => {
  test("upstream dies mid-stream → readable errors, not a clean close", async () => {
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const [outcome, drained] = await Promise.all([
      relaySse(body(["data: partial\n"], "upstream socket closed"), writable.getWriter(), passthrough),
      drain(readable),
    ]);
    expect(outcome).toMatchObject({ ok: false, side: "upstream", message: "upstream socket closed" });
    // The regression this guards: a graceful close here reads as "complete" to the client
    expect(drained.error).toBe("upstream socket closed");
    expect(drained.text).toBe("data: partial\n");
  });

  test("client disconnects → reported as the client side, relay does not throw", async () => {
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    await readable.cancel("client gone");
    const outcome = await relaySse(body(["data: 1\n"]), writable.getWriter(), passthrough);
    expect(outcome).toMatchObject({ ok: false, side: "client" });
  });

  test("upstream failure after the final newline is still a failure", async () => {
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const [outcome] = await Promise.all([
      relaySse(body(["data: done\n\n"], "read ECONNRESET"), writable.getWriter(), passthrough),
      drain(readable),
    ]);
    expect(outcome).toMatchObject({ ok: false, side: "upstream" });
  });
});
