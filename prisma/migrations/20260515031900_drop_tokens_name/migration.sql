-- Remove the redundant `name` column from `tokens`. Owner identity is now
-- canonically resolved from `users.name` via `tokens.user_id`, and any
-- admin-set identifier lives in `tokens.label`. The legacy `name` field
-- duplicated `users.name` and went stale on user renames.
ALTER TABLE "tokens" DROP COLUMN IF EXISTS "name";
