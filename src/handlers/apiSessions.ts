import { sql } from "drizzle-orm";
import { db } from "../db";

const SESSION_GAP_MS = 30 * 60 * 1000;

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

export async function handleApiSessions(user: string): Promise<Response> {
  const result = await db.execute(sql`
    SELECT ts, input_tokens, output_tokens, cache_read, cache_creation,
           model, messages_json, response_text
    FROM request_logs
    WHERE (name = ${user} OR (name = '' AND token_key = ${user})) AND status < 400
    ORDER BY ts ASC
  `);
  const rows = ((result as any).rows ?? []) as {
    ts: number; input_tokens: number; output_tokens: number;
    cache_read: number; cache_creation: number;
    model: string; messages_json: string; response_text: string;
  }[];

  if (!rows.length) return Response.json({ sessions: [] });

  const sessions: Session[] = [];
  let group: typeof rows = [];

  for (const row of rows) {
    const prev = group[group.length - 1];
    if (prev && Number(row.ts) - Number(prev.ts) > SESSION_GAP_MS) {
      sessions.push(buildSession(group));
      group = [];
    }
    group.push(row);
  }
  if (group.length) sessions.push(buildSession(group));

  return Response.json({ sessions: sessions.reverse() });
}

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
  const total_tokens = rows.reduce((s, r) => s + Number(r.input_tokens) + Number(r.output_tokens), 0);
  const exchanges: Exchange[] = rows.map(r => ({
    ts:            Number(r.ts),
    user:          lastUserText(r.messages_json),
    assistant:     r.response_text || "",
    input_tokens:  Number(r.input_tokens),
    output_tokens: Number(r.output_tokens),
    cache_read:    Number(r.cache_read),
    total_tokens:  Number(r.input_tokens) + Number(r.output_tokens),
  }));
  return {
    id:            `${first.ts}`,
    start_ts:      Number(first.ts),
    end_ts:        Number(last.ts),
    request_count: rows.length,
    total_tokens,
    model:         last.model,
    exchanges,
  };
}
