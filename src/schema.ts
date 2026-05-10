import {
  pgTable, text, integer, bigint, real, boolean, primaryKey, index, uniqueIndex, timestamp,
} from "drizzle-orm/pg-core";

// ── tokens ────────────────────────────────────────────────────────────────────
export const tokens = pgTable("tokens", {
  key:          text("key").primaryKey(),
  name:         text("name").notNull().default(""),
  user_id:      text("user_id").notNull().default(""),
  lim:          bigint("lim", { mode: "number" }),             // NULL = unlimited (Infinity)
  win:          bigint("win", { mode: "number" }).notNull(),
  used:         bigint("used", { mode: "number" }).notNull().default(0),
  window_start: bigint("window_start", { mode: "number" }).notNull(),
  paused:       boolean("paused").notNull().default(false),
  dynamic:      boolean("dynamic").notNull().default(false),
  deleted:      boolean("deleted").notNull().default(false),
  provider:     text("provider").notNull().default("inherit"),
});

// ── request_logs ──────────────────────────────────────────────────────────────
export const requestLogs = pgTable("request_logs", {
  id:             integer("id").primaryKey().generatedAlwaysAsIdentity(),
  ts:             bigint("ts", { mode: "number" }).notNull(),
  token_key:      text("token_key").notNull(),
  name:           text("name").notNull().default(""),
  user_id:        text("user_id").notNull().default(""),
  model:          text("model").notNull().default(""),
  input_tokens:   integer("input_tokens").notNull().default(0),
  output_tokens:  integer("output_tokens").notNull().default(0),
  cache_read:     integer("cache_read").notNull().default(0),
  cache_creation: integer("cache_creation").notNull().default(0),
  stream:         boolean("stream").notNull().default(false),
  status:         integer("status").notNull().default(200),
  stop_reason:    text("stop_reason").notNull().default(""),
  tool_use_count: integer("tool_use_count").notNull().default(0),
  duration_ms:    integer("duration_ms").notNull().default(0),
  turns:          integer("turns").notNull().default(0),
  prompt:         text("prompt").notNull().default(""),
  system_prompt:  text("system_prompt").notNull().default(""),
  messages_json:  text("messages_json").notNull().default(""),
  response_text:  text("response_text").notNull().default(""),
}, t => [
  index("idx_rl_ts").on(t.ts),
  index("idx_rl_key").on(t.token_key, t.ts),
]);

// ── daily_usage ───────────────────────────────────────────────────────────────
export const dailyUsage = pgTable("daily_usage", {
  date:      text("date").notNull(),
  token_key: text("token_key").notNull(),
  user_id:   text("user_id").notNull().default(""),
  used:      integer("used").notNull().default(0),
}, t => [
  primaryKey({ columns: [t.date, t.token_key] }),
]);

// ── upstream_state ────────────────────────────────────────────────────────────
export const upstreamState = pgTable("upstream_state", {
  id:                   integer("id").primaryKey().default(1),
  last_known_resets_at: text("last_known_resets_at"),
  detected_window_ms:   bigint("detected_window_ms", { mode: "number" }),
  last_poll:            bigint("last_poll", { mode: "number" }),
  five_hour_util:       real("five_hour_util"),
  five_hour_resets_at:  text("five_hour_resets_at"),
  seven_day_util:       real("seven_day_util"),
  seven_day_resets_at:  text("seven_day_resets_at"),
  sonnet_util:          real("sonnet_util"),
  sonnet_resets_at:     text("sonnet_resets_at"),
  opus_util:            real("opus_util"),
  opus_resets_at:       text("opus_resets_at"),
});

// ── users ─────────────────────────────────────────────────────────────────────
export const users = pgTable("users", {
  id:          text("id").primaryKey(),
  name:        text("name").notNull(),
  email:       text("email").notNull().default(""),
  description: text("description").notNull().default(""),
  created_at:  bigint("created_at", { mode: "number" }).notNull(),
  role:        text("role").notNull().default("USER"),
});

// ── model_routes ──────────────────────────────────────────────────────────────
export const modelRoutes = pgTable("model_routes", {
  model_id:   text("model_id").primaryKey(),
  threshold:  real("threshold").notNull().default(0.90),
  action:     text("action").notNull().default("block"),
  fallback_to:text("fallback_to"),
});

// ── settings ──────────────────────────────────────────────────────────────────
export const settings = pgTable("settings", {
  key:   text("key").primaryKey(),
  value: text("value").notNull(),
});

// ── Better Auth tables ────────────────────────────────────────────────────────
export const baUser = pgTable("user", {
  id:            text("id").primaryKey(),
  name:          text("name").notNull(),
  email:         text("email").notNull(),
  emailVerified: boolean("emailVerified").notNull().default(false),
  image:         text("image"),
  createdAt:     timestamp("createdAt").notNull(),
  updatedAt:     timestamp("updatedAt").notNull(),
  role:          text("role").notNull().default("USER"),
}, t => [
  uniqueIndex("user_email_idx").on(t.email),
]);

export const baSession = pgTable("session", {
  id:        text("id").primaryKey(),
  expiresAt: timestamp("expiresAt").notNull(),
  token:     text("token").notNull(),
  createdAt: timestamp("createdAt").notNull(),
  updatedAt: timestamp("updatedAt").notNull(),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  userId:    text("userId").notNull().references(() => baUser.id, { onDelete: "cascade", onUpdate: "cascade" }),
}, t => [
  uniqueIndex("session_token_idx").on(t.token),
]);

export const baAccount = pgTable("account", {
  id:                    text("id").primaryKey(),
  accountId:             text("accountId").notNull(),
  providerId:            text("providerId").notNull(),
  userId:                text("userId").notNull().references(() => baUser.id, { onDelete: "cascade", onUpdate: "cascade" }),
  accessToken:           text("accessToken"),
  refreshToken:          text("refreshToken"),
  idToken:               text("idToken"),
  accessTokenExpiresAt:  timestamp("accessTokenExpiresAt"),
  refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt"),
  scope:                 text("scope"),
  password:              text("password"),
  createdAt:             timestamp("createdAt").notNull(),
  updatedAt:             timestamp("updatedAt").notNull(),
});

export const baVerification = pgTable("verification", {
  id:         text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value:      text("value").notNull(),
  expiresAt:  timestamp("expiresAt").notNull(),
  createdAt:  timestamp("createdAt"),
  updatedAt:  timestamp("updatedAt"),
});
