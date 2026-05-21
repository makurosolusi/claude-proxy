-- Add context-block columns. Used to auto-block users whose request context
-- exceeds the supported size. `context_blocked_at` is epoch ms when blocked,
-- `context_block_reason` is the human-readable reason shown in the UI.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "context_blocked_at"   BIGINT,
  ADD COLUMN IF NOT EXISTS "context_block_reason" TEXT;
