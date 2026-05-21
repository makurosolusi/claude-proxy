-- Add grace-window column for context-block flow. When a user is blocked but
-- granted a temporary grace period, `context_block_grace_until` holds the
-- epoch ms when the grace expires. Proxy allows requests through while now
-- is still within this window.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "context_block_grace_until" BIGINT;
