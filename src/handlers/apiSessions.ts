import { db } from "../state";

const SESSION_GAP_MS = 30 * 60 * 1000; // 30 min gap = new session

export interface ConvTurn { role: "user" | "assistant"; text: string; }

export interface Session {
  id:            string;
  start_ts:      number;
  end_ts:        number;
  request_count: number;
  total_tokens:  number;
  model:         string;
  turns:         ConvTurn[];  // full conversation from last request + its response
}

export function handleApiSessions(user: string): Response {
  const rows = db.query(`
    SELECT ts, input_tokens, output_tokens, cache_read, cache_creation,
           model, messages_json, response_text, turns
    FROM request_logs
    WHERE token_key = ? AND status < 400
    ORDER BY ts ASC
  `).all(user) as {
    ts: number; input_tokens: number; output_tokens: number;
    cache_read: number; cache_creation: number;
    model: string; messages_json: string; response_text: string; turns: number;
  }[];

  if (!rows.length) return Response.json({ sessions: [] });

  // Group rows into sessions by time gap
  const sessions: Session[] = [];
  let group: typeof rows = [];

  for (const row of rows) {
    const prev = group[group.length - 1];
    if (prev && row.ts - prev.ts > SESSION_GAP_MS) {
      sessions.push(buildSession(group));
      group = [];
    }
    group.push(row);
  }
  if (group.length) sessions.push(buildSession(group));

  // Return newest first
  return Response.json({ sessions: sessions.reverse() });
}

function buildSession(rows: {
  ts: number; input_tokens: number; output_tokens: number;
  cache_read: number; cache_creation: number;
  model: string; messages_json: string; response_text: string; turns: number;
}[]): Session {
  const first = rows[0]!;
  const last  = rows[rows.length - 1]!;

  const total_tokens = rows.reduce(
    (s, r) => s + r.input_tokens + r.output_tokens + r.cache_read + r.cache_creation, 0
  );

  // Parse conversation from the last request (most complete context)
  let turns: ConvTurn[] = [];
  if (last.messages_json) {
    try {
      const parsed = JSON.parse(last.messages_json) as { role: string; text: string }[];
      turns = parsed
        .filter(t => t.text?.trim())
        .map(t => ({ role: t.role === "assistant" ? "assistant" : "user", text: t.text }));
    } catch {}
  }

  // Append the AI response to the last user message (not yet in messages_json)
  if (last.response_text?.trim()) {
    turns.push({ role: "assistant", text: last.response_text });
  }

  return {
    id:            `${first.ts}`,
    start_ts:      first.ts,
    end_ts:        last.ts,
    request_count: rows.length,
    total_tokens,
    model:         last.model,
    turns,
  };
}
