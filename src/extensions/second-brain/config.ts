export type ScopeMode = "user" | "shared" | "user-with-shared-fallback";

// Mining provider — distillation can run on any configured provider.
// "auto" = pick the best available (anthropic > openrouter > deepseek).
export type MiningProvider = "auto" | "anthropic" | "openrouter" | "deepseek";

// NOTE: Cache feature was removed (see commit removing src/extensions/second-brain/cache.ts).
// It caused stale-response bugs in interactive chat and provided no real value.
// Mining + injection remain — they're additive (modify prompt) not substitutive
// (serve cached response), so they're fundamentally safer.
export interface SecondBrainConfig {
  scope:                    ScopeMode;
  miningEnabled:            boolean;
  miningThrottlePerHour:    number;
  miningProvider:           MiningProvider;
  miningModel:              string; // hint — falls back to provider default when incompatible
  injectionEnabled:         boolean;
  injectionTopK:            number;
  abTestingEnabled:         boolean;
}

export const defaultConfig: SecondBrainConfig = {
  scope:                    "user",
  miningEnabled:            true,
  miningThrottlePerHour:    20,
  miningProvider:           "auto",
  miningModel:              "claude-haiku-4-5-20251001",
  injectionEnabled:         true,
  injectionTopK:            3,
  abTestingEnabled:         false,
};

export const EMBEDDING_DIM = 384;
export const EMBEDDING_MODEL = "Xenova/bge-small-en-v1.5";
