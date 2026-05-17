-- Drop Second Brain prompt cache. Cache feature was removed because the
-- intercept-stream-and-replay pattern caused stale-response bugs in
-- interactive chat. Mining + strategy injection remain (additive paths,
-- safer by design).
DROP TABLE IF EXISTS sb_prompt_cache;

-- Stale setting key from cache key scheme upgrade logic (also removed).
DELETE FROM settings WHERE key = 'sb_cache_key_scheme';
