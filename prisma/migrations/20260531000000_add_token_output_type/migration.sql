-- Per-token output format: "anthropic" (default) keeps existing behavior,
-- "openai" makes the proxy accept /v1/chat/completions and return OpenAI-format responses.
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS output_type TEXT NOT NULL DEFAULT 'anthropic';
