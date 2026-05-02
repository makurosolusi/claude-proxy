import { createContext, useContext } from "react";

export interface TokenStatus {
  label: string; used: number; limit: number | null;
  remaining: number | null; pct: number; paused: boolean; today: number;
}
export interface UpstreamPeriod { utilization: number; resets_at: string; }
export interface UpstreamData {
  ok: boolean; stale: boolean; error: string | null; email: string | null;
  pollAge: string | null; nextPoll: string | null;
  fiveHour: UpstreamPeriod | null; sevenDay: UpstreamPeriod | null;
  sevenDaySonnet: UpstreamPeriod | null;
}
export interface StatusResponse {
  ts: string; pollAge: string; isAdmin: boolean;
  tokens: Record<string, TokenStatus>; upstream: UpstreamData;
  totalAllTime: number;
}
export interface LogEntry {
  id: number; ts: number; token_key: string; model: string;
  input_tokens: number; output_tokens: number; cache_read: number;
  cache_creation: number; stream: boolean; status: number;
  stop_reason: string; tool_use_count: number; duration_ms: number;
  turns: number; prompt: string; system_prompt: string;
  messages_json: string; response_text: string;
}
export interface ChatMsg { id: string; type: "chat" | "system"; nick: string; text: string; ts: number; }
export interface ChatCtxType { messages: ChatMsg[]; send: (nick: string, text: string) => void; }

export const StatusCtx = createContext<StatusResponse | null>(null);
export function useStatus() { return useContext(StatusCtx); }

export const ChatCtx = createContext<ChatCtxType>({ messages: [], send: () => {} });
export function useChat() { return useContext(ChatCtx); }
