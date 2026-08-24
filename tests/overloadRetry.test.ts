/**
 * Tests for overloadRetry.ts — no server needed
 * Run: bun test tests/overloadRetry.test.ts
 */
import { describe, test, expect } from "bun:test";
import {
  OVERLOAD_STATUS,
  MAX_OVERLOAD_RETRIES,
  isOverloadStatus,
  isOverloadError,
  overloadBackoffMs,
  overloadDelayMs,
} from "../src/overloadRetry";

describe("isOverloadStatus", () => {
  test("529 → true", () => {
    expect(isOverloadStatus(OVERLOAD_STATUS)).toBe(true);
    expect(isOverloadStatus(529)).toBe(true);
  });
  test("non-529 → false", () => {
    for (const s of [200, 400, 401, 429, 500, 502, 503]) {
      expect(isOverloadStatus(s)).toBe(false);
    }
  });
});

describe("isOverloadError", () => {
  test("529 status alone → true", () => {
    expect(isOverloadError(529, null)).toBe(true);
  });
  test("overloaded_error body on non-529 status → true (gateway rewrote status)", () => {
    const body = { type: "error", error: { type: "overloaded_error", message: "Overloaded" } };
    expect(isOverloadError(503, body)).toBe(true);
  });
  test("top-level type overloaded_error → true", () => {
    expect(isOverloadError(200, { type: "overloaded_error" })).toBe(true);
  });
  test("message contains 'overloaded' (case-insensitive) → true", () => {
    expect(isOverloadError(200, { error: { message: "Server OVERLOADED, retry" } })).toBe(true);
  });
  test("unrelated error → false", () => {
    const body = { error: { type: "rate_limit_error", message: "quota exceeded" } };
    expect(isOverloadError(429, body)).toBe(false);
  });
  test("empty/malformed body on ok status → false", () => {
    expect(isOverloadError(200, null)).toBe(false);
    expect(isOverloadError(200, {})).toBe(false);
    expect(isOverloadError(200, "garbage")).toBe(false);
  });
});

describe("overloadBackoffMs", () => {
  test("full jitter stays within [0, exp] and grows with attempt", () => {
    // rand()=1 yields the ceiling (exclusive in practice, floor() keeps it in range)
    expect(overloadBackoffMs(0, 500, 8000, () => 0.999999)).toBeLessThanOrEqual(500);
    expect(overloadBackoffMs(1, 500, 8000, () => 0.999999)).toBeLessThanOrEqual(1000);
    expect(overloadBackoffMs(2, 500, 8000, () => 0.999999)).toBeLessThanOrEqual(2000);
    expect(overloadBackoffMs(3, 500, 8000, () => 0.999999)).toBeLessThanOrEqual(4000);
  });
  test("rand()=0 → 0ms floor", () => {
    expect(overloadBackoffMs(3, 500, 8000, () => 0)).toBe(0);
  });
  test("respects cap", () => {
    expect(overloadBackoffMs(20, 500, 8000, () => 0.999999)).toBeLessThanOrEqual(8000);
  });
  test("negative attempt clamped to 0", () => {
    expect(overloadBackoffMs(-5, 500, 8000, () => 0.5)).toBeLessThanOrEqual(500);
  });
});

describe("overloadDelayMs", () => {
  test("honors numeric retry-after (seconds → ms)", () => {
    expect(overloadDelayMs(0, "3")).toBe(3000);
  });
  test("clamps retry-after to 10s", () => {
    expect(overloadDelayMs(0, "60")).toBe(10_000);
  });
  test("ignores non-positive / invalid retry-after → jittered backoff", () => {
    expect(overloadDelayMs(0, "0", () => 0)).toBe(0);
    expect(overloadDelayMs(0, "abc", () => 0)).toBe(0);
    expect(overloadDelayMs(0, null, () => 0)).toBe(0);
  });
});

describe("retry budget", () => {
  test("MAX_OVERLOAD_RETRIES is a small positive bound", () => {
    expect(MAX_OVERLOAD_RETRIES).toBeGreaterThan(0);
    expect(MAX_OVERLOAD_RETRIES).toBeLessThanOrEqual(6);
  });
});
