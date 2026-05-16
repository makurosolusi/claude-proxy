import { EMBEDDING_DIM } from "./config";

export const CREATE_PGVECTOR_SQL = "CREATE EXTENSION IF NOT EXISTS vector";

export const CREATE_TABLES_SQL: string[] = [
  `CREATE TABLE IF NOT EXISTS sb_strategies (
    id            TEXT PRIMARY KEY,
    title         TEXT NOT NULL,
    when_to_use   TEXT NOT NULL DEFAULT '',
    content       TEXT NOT NULL DEFAULT '',
    pitfalls      TEXT NOT NULL DEFAULT '',
    embedding     vector(${EMBEDDING_DIM}),
    scope         TEXT NOT NULL DEFAULT 'user',
    user_id       TEXT NOT NULL DEFAULT '',
    project       TEXT NOT NULL DEFAULT '',
    tags          TEXT NOT NULL DEFAULT '[]',
    source_log_id INT,
    use_count     INT NOT NULL DEFAULT 0,
    success_count INT NOT NULL DEFAULT 0,
    fail_count    INT NOT NULL DEFAULT 0,
    created_at    BIGINT NOT NULL,
    updated_at    BIGINT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sb_strategies_user  ON sb_strategies(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sb_strategies_scope ON sb_strategies(scope)`,
  `CREATE INDEX IF NOT EXISTS idx_sb_strategies_embed_hnsw ON sb_strategies USING hnsw (embedding vector_cosine_ops)`,

  `CREATE TABLE IF NOT EXISTS sb_strategy_edges (
    from_id    TEXT NOT NULL,
    to_id      TEXT NOT NULL,
    edge_type  TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    PRIMARY KEY (from_id, to_id, edge_type)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sb_edges_from ON sb_strategy_edges(from_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sb_edges_to   ON sb_strategy_edges(to_id)`,

  `CREATE TABLE IF NOT EXISTS sb_prompt_cache (
    id              BIGSERIAL PRIMARY KEY,
    prompt_hash     TEXT NOT NULL,
    prompt          TEXT NOT NULL,
    embedding       vector(${EMBEDDING_DIM}),
    response_body   TEXT NOT NULL,
    response_text   TEXT NOT NULL DEFAULT '',
    input_tokens    INT NOT NULL DEFAULT 0,
    output_tokens   INT NOT NULL DEFAULT 0,
    model           TEXT NOT NULL DEFAULT '',
    provider        TEXT NOT NULL DEFAULT '',
    user_id         TEXT NOT NULL DEFAULT '',
    scope           TEXT NOT NULL DEFAULT 'user',
    hit_count       INT NOT NULL DEFAULT 0,
    created_at      BIGINT NOT NULL,
    expires_at      BIGINT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_sb_cache_hash    ON sb_prompt_cache(prompt_hash)`,
  `CREATE INDEX IF NOT EXISTS idx_sb_cache_user           ON sb_prompt_cache(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sb_cache_expires        ON sb_prompt_cache(expires_at)`,
  `CREATE INDEX IF NOT EXISTS idx_sb_cache_embed_hnsw     ON sb_prompt_cache USING hnsw (embedding vector_cosine_ops)`,

  `CREATE TABLE IF NOT EXISTS sb_extension_logs (
    id         BIGSERIAL PRIMARY KEY,
    ts         BIGINT NOT NULL,
    event_type TEXT NOT NULL,
    detail     TEXT NOT NULL DEFAULT '{}',
    user_id    TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sb_logs_ts   ON sb_extension_logs(ts DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_sb_logs_type ON sb_extension_logs(event_type)`,
];

export const DROP_TABLES_SQL: string[] = [
  "DROP TABLE IF EXISTS sb_extension_logs",
  "DROP TABLE IF EXISTS sb_prompt_cache",
  "DROP TABLE IF EXISTS sb_strategy_edges",
  "DROP TABLE IF EXISTS sb_strategies",
];
