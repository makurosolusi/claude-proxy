CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"accountId" text NOT NULL,
	"providerId" text NOT NULL,
	"userId" text NOT NULL,
	"accessToken" text,
	"refreshToken" text,
	"idToken" text,
	"accessTokenExpiresAt" timestamp,
	"refreshTokenExpiresAt" timestamp,
	"scope" text,
	"password" text,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"token" text NOT NULL,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL,
	"ipAddress" text,
	"userAgent" text,
	"userId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"emailVerified" boolean DEFAULT false NOT NULL,
	"image" text,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL,
	"role" text DEFAULT 'USER' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"createdAt" timestamp,
	"updatedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "daily_usage" (
	"date" text NOT NULL,
	"token_key" text NOT NULL,
	"user_id" text DEFAULT '' NOT NULL,
	"used" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "daily_usage_date_token_key_pk" PRIMARY KEY("date","token_key")
);
--> statement-breakpoint
CREATE TABLE "model_routes" (
	"model_id" text PRIMARY KEY NOT NULL,
	"threshold" real DEFAULT 0.9 NOT NULL,
	"action" text DEFAULT 'block' NOT NULL,
	"fallback_to" text
);
--> statement-breakpoint
CREATE TABLE "request_logs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "request_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"ts" bigint NOT NULL,
	"token_key" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"user_id" text DEFAULT '' NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read" integer DEFAULT 0 NOT NULL,
	"cache_creation" integer DEFAULT 0 NOT NULL,
	"stream" boolean DEFAULT false NOT NULL,
	"status" integer DEFAULT 200 NOT NULL,
	"stop_reason" text DEFAULT '' NOT NULL,
	"tool_use_count" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"turns" integer DEFAULT 0 NOT NULL,
	"prompt" text DEFAULT '' NOT NULL,
	"system_prompt" text DEFAULT '' NOT NULL,
	"messages_json" text DEFAULT '' NOT NULL,
	"response_text" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tokens" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"user_id" text DEFAULT '' NOT NULL,
	"lim" bigint,
	"win" bigint NOT NULL,
	"used" bigint DEFAULT 0 NOT NULL,
	"window_start" bigint NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"dynamic" boolean DEFAULT false NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"provider" text DEFAULT 'inherit' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "upstream_state" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"last_known_resets_at" text,
	"detected_window_ms" bigint,
	"last_poll" bigint,
	"five_hour_util" real,
	"five_hour_resets_at" text,
	"seven_day_util" real,
	"seven_day_resets_at" text,
	"sonnet_util" real,
	"sonnet_resets_at" text,
	"opus_util" real,
	"opus_resets_at" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" bigint NOT NULL,
	"role" text DEFAULT 'USER' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "session_token_idx" ON "session" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "user_email_idx" ON "user" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_rl_ts" ON "request_logs" USING btree ("ts");--> statement-breakpoint
CREATE INDEX "idx_rl_key" ON "request_logs" USING btree ("token_key","ts");