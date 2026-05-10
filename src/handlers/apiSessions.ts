import { prisma } from "../prisma";

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
  const rows = await prisma.request_logs.findMany({
    where: {
      status: { lt: 400 },
      OR: [
        { name: user },
        { AND: [{ name: "" }, { token_key: user }] },
      ],
    },
    select: { ts: true, input_tokens: true, output_tokens: true, cache_read: true, cache_creation: true, model: true, messages_json: true, response_text: true },
    orderBy: { ts: "asc" },
  });

  if (!rows.length) return Response.json({ sessions: [] });

  type Row = typeof rows[number];
  const sessions: Session[] = [];
  let group: Row[] = [];

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

function buildSession(rows: any[]): Session {
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
