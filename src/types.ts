export type UserRole   = "SUPER_ADMIN" | "ADMIN" | "USER";
export type UserStatus = "pending" | "approved" | "blocked";

export interface UserEntry {
  id:          string;   // stable slug, never changes
  name:        string;   // display name (editable)
  email:       string;   // Google account email (for OAuth login)
  description: string;
  created_at:  number;   // epoch ms
  role:        UserRole;
  status:      UserStatus;
}

export type TokenProvider = "inherit" | "anthropic" | "deepseek" | "openrouter";

// Quota reset semantics:
// - "manual": never auto-reset. Admin must reset or raise limit when quota is hit.
// - "auto":   legacy rolling-window — reset every `window` ms AND when Anthropic
//             5h window rotates. Existing tokens are migrated to this.
// - "daily":  reset at local midnight only; ignores Anthropic rotation.
export type ResetMode = "manual" | "auto" | "daily";

export interface TokenEntry {
  limit:        number;   // Infinity = unlimited
  window:       number;   // ms — used by mode=auto
  used:         number;
  windowStart:  number;   // epoch ms — for mode=auto rolling window; for manual/daily this is "since last reset" (display only)
  paused:       boolean;
  dynamic:      boolean;
  mode:         "inherit" | "direct" | "cliproxy";
  provider:     TokenProvider;
  user_id:      string;   // references users.id — owner identity comes from here
  label:        string;   // admin-set explicit label, optional
  description:  string;   // admin-set description
  pinned_model: string;   // if non-empty, force this model for all requests on this token
  reset_mode:   ResetMode; // see ResetMode docs above
  last_reset:   number;   // epoch ms; 0 if never. Used to gate daily mode + UI display.
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
