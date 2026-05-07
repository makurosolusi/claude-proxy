export interface ModelRoute {
  model_id:    string;   // canonical Anthropic model ID: "claude-sonnet-4-6", "claude-opus-4-7", or "*" for 5h global
  threshold:   number;   // 0–1 (0.90 = 90%)
  action:      "redirect" | "block";
  fallback_to: string | null;  // model_id tujuan redirect
}

export interface UserEntry {
  id:          string;   // stable slug, never changes
  name:        string;   // display name (editable)
  description: string;
  created_at:  number;   // epoch ms
}

export type TokenProvider = "inherit" | "anthropic" | "deepseek" | "openrouter";

export interface TokenEntry {
  limit:       number;   // Infinity = unlimited
  window:      number;   // ms
  used:        number;
  windowStart: number;   // epoch ms
  paused:      boolean;
  dynamic:     boolean;
  mode:        "inherit" | "direct" | "cliproxy";
  provider:    TokenProvider;
  name:        string;   // display name, mirrors user.name for active tokens
  user_id:     string;   // references users.id
}


export interface UsagePeriod {
  utilization: number;
  resets_at:   string;
}

export interface UpstreamState {
  fiveHour:          UsagePeriod | null;
  sevenDay:          UsagePeriod | null;
  sevenDaySonnet:    UsagePeriod | null;
  sevenDayOpus:      UsagePeriod | null;
  lastPoll:          number;
  lastPollOk:        boolean;
  lastError:         string | null;
  lastKnownResetsAt: string | null;
  detectedWindowMs:  number | null;
  pollBackoffUntil:  number;
  tokenCache:        { value: string | null; readAt: number; email: string | null; credential?: import("./upstream").OauthCredential };
  fallbackActive:    boolean;
  fallbackProvider:  string | null;
}

export interface DailyUsage {
  [date: string]: { [tokenKey: string]: number };
}

export interface RequestLogEntry {
  id:             number;
  ts:             number;
  token_key:      string;
  user_id:        string;   // references users.id (backfilled for old rows)
  name:           string;   // snapshot of token display name at request time
  model:          string;
  input_tokens:   number;
  output_tokens:  number;
  cache_read:     number;
  cache_creation: number;
  stream:         boolean;
  status:         number;
  stop_reason:    string;
  tool_use_count: number;
  duration_ms:    number;
  turns:          number;
  prompt:         string;
  system_prompt:  string;
  messages_json:  string; // JSON: [{role,text},...] full conversation context
  response_text:  string; // AI response text (truncated)
}
