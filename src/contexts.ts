import { createContext, useContext } from "react";
import type { ModelRoute } from "./types";

export interface TokenStatus {
  label: string; name: string; user_id: string;
  used: number; limit: number | null;
  remaining: number | null; pct: number; paused: boolean; today: number; alltime: number;
  provider:       string;
  activeProvider: string;
  activeModel:    string | null;
}
export interface UpstreamPeriod { utilization: number; resets_at: string; }
export interface UpstreamData {
  ok: boolean; stale: boolean; error: string | null; email: string | null;
  pollAge: string | null; nextPoll: string | null;
  fiveHour: UpstreamPeriod | null; sevenDay: UpstreamPeriod | null;
  sevenDaySonnet: UpstreamPeriod | null;
  fallbackProvider: string | null;
  activeProvider:   string | null;
  activeModel:      string | null;
}
export type AlertSeverity = "warning" | "critical";
export type UserProfile   = "agentic" | "conversational" | "heavy_reader" | "efficient" | "mixed";
export type QuotaAction   = "increase" | "decrease" | "ok";

export interface ContextAlert {
  label:        string;
  input_tokens: number;
  output_tokens:number;
  turns:        number;
  ratio:        number;
  severity:     AlertSeverity;
  ts:           number;
}

export interface ThresholdAlert {
  label: string;
  type:  "quota_80" | "quota_95" | "high_context" | "upstream_85" | "error_storm";
  value: number;
  ts:    number;
  msg:   string;
}

export interface UserInsight {
  sparkline:      number[];
  burnRate: {
    hoursLeft:    number | null;
    avgDaily:     number;
    spikeMultiple:number;
  };
  profile:        UserProfile;
  profileReason:  string;
  cacheHitRate:   number;
  avgInputTokens: number;
  stopReasons:    Record<string, number>;
  quotaSuggestion: { action: QuotaAction; suggested: number | null; reason: string } | null;
}

export interface StatusResponse {
  ts: string; pollAge: string; isAdmin: boolean;
  tokens: Record<string, TokenStatus>; upstream: UpstreamData;
  totalAllTime:    number;
  contextAlerts:   ContextAlert[];
  thresholdAlerts: ThresholdAlert[];
  insights:        Record<string, UserInsight>;
  modelRoutes:      ModelRoute[];
}
export interface LogEntry {
  id: number; ts: number; token_key: string; name: string; model: string;
  input_tokens: number; output_tokens: number; cache_read: number;
  cache_creation: number; stream: boolean; status: number;
  stop_reason: string; tool_use_count: number; duration_ms: number;
  turns: number; prompt: string; system_prompt: string;
  messages_json: string; response_text: string;
}

export interface ProfileToken {
  key: string; name: string; used: number; limit: number | null;
  remaining: number | null; pct: number; paused: boolean;
  provider: string; today: number; alltime: number;
}

export interface ProfileResponse {
  authenticated: boolean;
  userId?:   string;
  email?:    string;
  name?:     string;
  role?:     "SUPER_ADMIN" | "ADMIN" | "USER";
  tokens?:   Record<string, ProfileToken>;
}
export interface ChatMsg { id: string; type: "chat" | "system"; nick: string; text: string; ts: number; }
export interface ChatCtxType { messages: ChatMsg[]; send: (nick: string, text: string) => void; }

export const StatusCtx = createContext<StatusResponse | null>(null);
export function useStatus() { return useContext(StatusCtx); }

export const ChatCtx = createContext<ChatCtxType>({ messages: [], send: () => {} });
export function useChat() { return useContext(ChatCtx); }
