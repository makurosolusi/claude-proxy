export type RelayOutcome =
  | { ok: true }
  | { ok: false; side: "upstream" | "client"; message: string };

/**
 * Relay an SSE body into `writer`, letting `transform` rewrite or expand each
 * line (return the exact chunks to emit; must not throw).
 *
 * This owns the writer's terminal state on purpose: a stream that dies
 * mid-flight has to end *abnormally*. Closing it gracefully yields a
 * well-formed HTTP 200 whose SSE never reached `message_stop` — the client gets
 * no network error to retry on, so it shows the user "Connection lost
 * mid-response" instead.
 */
export async function relaySse(
  body: ReadableStream<Uint8Array>,
  writer: WritableStreamDefaultWriter<Uint8Array>,
  transform: (line: string) => string[],
): Promise<RelayOutcome> {
  const reader  = body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  let writing = false;   // true while awaiting the client → tells the two sides apart
  const write = async (chunk: string) => {
    writing = true;
    await writer.write(encoder.encode(chunk));
    writing = false;
  };

  try {
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // Split on newlines but keep the terminator so lines can be rewritten
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines)
        for (const chunk of transform(line)) await write(chunk);
    }
    if (buffer) await write(buffer);
    writing = true;
    await writer.close();
    return { ok: true };
  } catch (err: any) {
    const side = writing ? "client" : "upstream";
    // Client gone → stop pulling upstream instead of paying for bytes nobody reads
    await reader.cancel(err).catch(() => {});
    await writer.abort(err).catch(() => {});
    return { ok: false, side, message: err?.message || String(err) };
  }
}
