export interface LogManagementConfig {
  retentionDays:     number;  // delete entries older than this (default 7)
  pruneIntervalHrs:  number;  // how often the prune scheduler fires (default 24)
  flushIntervalMs:   number;  // batch buffer flush cadence (default 2000)
  flushMaxBatch:     number;  // max lines per batch insert (default 200)
  captureLevels:     ("info" | "warn" | "error")[]; // which levels to persist
}

export const defaultConfig: LogManagementConfig = {
  retentionDays:    7,
  pruneIntervalHrs: 24,
  flushIntervalMs:  2000,
  flushMaxBatch:    200,
  captureLevels:    ["info", "warn", "error"],
};
