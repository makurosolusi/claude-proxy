export type UserRole   = "SUPER_ADMIN" | "ADMIN" | "USER";
export type UserStatus = "pending" | "approved" | "blocked";

export interface UserEntry {
  id:                   string;   // stable slug, never changes
  name:                 string;   // display name (editable)
  email:                string;   // Google account email (for OAuth login)
  description:          string;
  created_at:           number;   // epoch ms
  role:                 UserRole;
  status:               UserStatus;
  context_blocked_at?:  number;   // epoch ms; set when auto-blocked for oversized context
  context_block_reason?: string;
}

export type TokenProvider = "inherit" | "anthropic" | "deepseek" | "openrouter";

// Quota reset policy — applies globally to ALL tokens via settings.reset_mode.
// - "manual": never auto-reset. Admin must reset or raise limit when quota hit.
// - "auto":   legacy rolling-window. Resets every `window` ms AND when Anthropic
//             5h window rotates.
// - "daily":  reset at local midnight only; ignores Anthropic rotation.
// NOTE: This is intentionally NOT a per-token field. Single source of truth.
export type ResetMode = "manual" | "auto" | "daily";

export interface TokenEntry {
  limit:        number;   // Infinity = unlimited
  window:       number;   // ms — used when global reset_mode = "auto"
  used:         number;
  windowStart:  number;   // epoch ms — rolling window start (auto) or last-reset timestamp (manual/daily)
  paused:       boolean;
  dynamic:      boolean;
  mode:         "inherit" | "direct" | "cliproxy";
  provider:     TokenProvider;
  user_id:      string;   // references users.id — owner identity comes from here
  label:        string;   // admin-set explicit label, optional
  description:  string;   // admin-set description
  pinned_model: string;   // if non-empty, force this model for all requests on this token
  last_reset:   number;   // epoch ms; 0 if never. UI display only.
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
  name:           string;   // legacy snapshot of token display name at request time
  owner_name:     string;   // current owner display name (resolved from tokens[].user_id)
  token_label:    string;   // current token routing label (distinct from owner)
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
