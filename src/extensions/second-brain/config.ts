export type ScopeMode = "user" | "shared" | "user-with-shared-fallback";

export interface SecondBrainConfig {
  cacheEnabled:             boolean;
  cacheTtlHours:            number;
  cacheSimilarityThreshold: number;
  cacheJudgeEnabled:        boolean;
  scope:                    ScopeMode;
  miningEnabled:            boolean;
  miningThrottlePerHour:    number;
  miningModel:              string;
  injectionEnabled:         boolean;
  injectionTopK:            number;
  abTestingEnabled:         boolean;
}

export const defaultConfig: SecondBrainConfig = {
  cacheEnabled:             true,
  cacheTtlHours:            168,
  cacheSimilarityThreshold: 0.92,
  cacheJudgeEnabled:        true,
  scope:                    "user",
  miningEnabled:            true,
  miningThrottlePerHour:    20,
  miningModel:              "claude-haiku-4-5-20251001",
  injectionEnabled:         true,
  injectionTopK:            3,
  abTestingEnabled:         false,
};

export const EMBEDDING_DIM = 384;
export const EMBEDDING_MODEL = "Xenova/bge-small-en-v1.5";
