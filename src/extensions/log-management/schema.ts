export const CREATE_TABLES_SQL = [
  `CREATE TABLE IF NOT EXISTS app_logs (
    id        BIGSERIAL PRIMARY KEY,
    ts        BIGINT NOT NULL,
    level     TEXT   NOT NULL,
    source    TEXT   NOT NULL DEFAULT 'console',
    message   TEXT   NOT NULL,
    context   JSONB
  )`,
  `CREATE INDEX IF NOT EXISTS idx_app_logs_ts        ON app_logs(ts DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_app_logs_level_ts  ON app_logs(level, ts DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_app_logs_source_ts ON app_logs(source, ts DESC)`,
];
