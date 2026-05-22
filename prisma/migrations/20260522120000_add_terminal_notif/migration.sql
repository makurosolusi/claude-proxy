-- Extend admin_notifications with deliver_via + priority so admin can choose
-- whether a broadcast appears in the web modal, gets injected into CLI
-- responses, or both. Default `web` preserves existing behavior.
ALTER TABLE "admin_notifications"
  ADD COLUMN IF NOT EXISTS "deliver_via" TEXT NOT NULL DEFAULT 'web',
  ADD COLUMN IF NOT EXISTS "priority"    TEXT NOT NULL DEFAULT 'info';

-- Per-user terminal delivery ledger. Distinct from notification_dismissals
-- because dismissing the web modal should NOT mark terminal delivered (and
-- vice versa). A row exists iff the announcement has been injected into a
-- /v1/messages response for that user — so we never inject twice.
CREATE TABLE IF NOT EXISTS "notification_terminal_deliveries" (
  "notification_id" TEXT NOT NULL,
  "user_id"         TEXT NOT NULL,
  "delivered_at"    BIGINT NOT NULL,
  PRIMARY KEY ("notification_id", "user_id")
);
CREATE INDEX IF NOT EXISTS "idx_notif_term_user"
  ON "notification_terminal_deliveries" ("user_id");
