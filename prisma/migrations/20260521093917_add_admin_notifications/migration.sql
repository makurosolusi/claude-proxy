-- Admin-to-user broadcast notifications. `admin_notifications` holds the
-- message + targeting (all users vs. specific user_ids JSON). Per-user
-- dismissals live in `notification_dismissals` so each user can independently
-- close the modal; deleting an admin notification cascades by filtering with
-- `deleted=false` in queries (soft delete keeps history without orphaning rows).
CREATE TABLE IF NOT EXISTS "admin_notifications" (
  "id"          TEXT PRIMARY KEY,
  "message"     TEXT NOT NULL,
  "created_at"  BIGINT NOT NULL,
  "created_by"  TEXT NOT NULL DEFAULT '',
  "target_type" TEXT NOT NULL DEFAULT 'all',
  "target_ids"  TEXT NOT NULL DEFAULT '',
  "deleted"     BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS "idx_admin_notif_active"
  ON "admin_notifications" ("deleted", "created_at" DESC);

CREATE TABLE IF NOT EXISTS "notification_dismissals" (
  "notification_id" TEXT NOT NULL,
  "user_id"         TEXT NOT NULL,
  "dismissed_at"    BIGINT NOT NULL,
  PRIMARY KEY ("notification_id", "user_id")
);
CREATE INDEX IF NOT EXISTS "idx_notif_dismiss_user"
  ON "notification_dismissals" ("user_id");
