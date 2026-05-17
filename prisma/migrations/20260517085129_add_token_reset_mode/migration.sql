-- Add reset_mode column. New tokens default to 'manual' (admin must reset or
-- raise limit when quota is hit). Existing tokens are migrated to 'auto' so
-- their behavior is preserved on upgrade.
ALTER TABLE "tokens"
  ADD COLUMN IF NOT EXISTS "reset_mode" TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS "last_reset" BIGINT;

-- Back-compat: pre-existing rows get 'auto' so users don't suddenly lose their
-- rolling-window reset behavior on upgrade. Only target rows that still have
-- the default — i.e. ones we just added the column to.
UPDATE "tokens" SET "reset_mode" = 'auto' WHERE "reset_mode" = 'manual' AND "last_reset" IS NULL;
