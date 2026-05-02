import { db } from "../state";

const SESSION_GAP_MS = 30 * 60 * 1000; // 30 min gap = new session

export interface Exchange {
  ts:           number;
  user:         string;
  assistant:    string;
  input_tokens: number;
  output_tokens:number;
  cache_read:   number;
  total_tokens: number;
}

export interface Session {
  id:            string;
  start_ts:      number;
  end_ts:        number;
  request_count: number;
  total_tokens:  number;
  model:         string;
  exchanges:     Exchange[];
}

export function handleApiSessions(user: string): Response {
  // user param is a display name — query by name (or fallback to token_key for old data)
  const rows = db.query(`
    SELECT ts, input_tokens, output_tokens, cache_read, cache_creation,
           model, messages_json, response_text
    FROM request_logs
    WHERE (name = ? OR (name = '' AND token_key = ?)) AND status < 400
    ORDER BY ts ASC
  `).all(user, user) as {
    ts: number; input_tokens: number; output_tokens: number;
    cache_read: number; cache_creation: number;
    model: string; messages_json: string; response_text: string;
  }[];

  if (!rows.length) return Response.json({ sessions: [] });

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

  return Response.json({ sessions: sessions.reverse() });
}

// Extract the last user message from a request's messages_json.
// Each request sends the full context; the last user entry is what the user asked THIS turn.
function lastUserText(messagesJson: string): string {
  if (!messagesJson) return "";
  try {
    const turns = JSON.parse(messagesJson) as { role: string; text: string }[];
    for (let i = turns.length - 1; i >= 0; i--) {
      if (turns[i]?.role === "user" && turns[i]?.text?.trim()) return turns[i]!.text;
    }
  } catch {}
  return "";
}

function buildSession(rows: {
  ts: number; input_tokens: number; output_tokens: number;
  cache_read: number; cache_creation: number;
  model: string; messages_json: string; response_text: string;
}[]): Session {
  const first = rows[0]!;
  const last  = rows[rows.length - 1]!;

  const total_tokens = rows.reduce(
    (s, r) => s + r.input_tokens + r.output_tokens, 0 // no cache, consistent with quota
  );

  // Each request = one exchange: user asked something → AI replied
  const exchanges: Exchange[] = rows.map(r => ({
    ts:           r.ts,
    user:         lastUserText(r.messages_json),
    assistant:    r.response_text || "",
    input_tokens: r.input_tokens,
    output_tokens:r.output_tokens,
    cache_read:   r.cache_read,
    total_tokens: r.input_tokens + r.output_tokens, // consistent with quota system (no cache)
  }));

  return {
    id:            `${first.ts}`,
    start_ts:      first.ts,
    end_ts:        last.ts,
    request_count: rows.length,
    total_tokens,
    model:         last.model,
    exchanges,
  };
}
