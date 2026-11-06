/**
 * Tests for credentialUsage.ts — last-used tracking with throttled persistence.
 * Run: bun test tests/credentialUsage.test.ts
 */
import { describe, test, expect } from "bun:test";
import { createCredentialUsageTracker, LAST_USED_PERSIST_INTERVAL_MS } from "../src/credentialUsage";

const flush = () => new Promise(r => setTimeout(r, 0));

function make(seed?: string) {
  const saves: Record<string, string>[] = [];
  const t = createCredentialUsageTracker({ seed: () => seed, save: json => { saves.push(JSON.parse(json)); } });
  return { t, saves };
}

describe("markCredentialUsed throttle", () => {
  test("first mark persists, second within window does not, after window persists latest", async () => {
    const { t, saves } = make();
    const t0 = Date.parse("2026-11-06T00:00:00.000Z");

    t.markCredentialUsed("claude-a.json", t0);
    await flush();
    expect(saves).toHaveLength(1);
    expect(saves[0]).toEqual({ "claude-a.json": "2026-11-06T00:00:00.000Z" });

    t.markCredentialUsed("claude-b.json", t0 + 1_000);
    await flush();
    expect(saves).toHaveLength(1);
    expect(t.getCredentialLastUsed()["claude-b.json"]).toBe("2026-11-06T00:00:01.000Z");

    t.markCredentialUsed("claude-a.json", t0 + LAST_USED_PERSIST_INTERVAL_MS);
    await flush();
    expect(saves).toHaveLength(2);
    expect(saves[1]).toEqual({
      "claude-a.json": new Date(t0 + LAST_USED_PERSIST_INTERVAL_MS).toISOString(),
      "claude-b.json": "2026-11-06T00:00:01.000Z",
    });
  });

  test("save failure is reported, not thrown", async () => {
    const t = createCredentialUsageTracker({ seed: () => undefined, save: () => Promise.reject(new Error("db down")) });
    expect(() => t.markCredentialUsed("claude-a.json", 1)).not.toThrow();
    await flush();
    expect(t.getCredentialLastUsed()["claude-a.json"]).toBe(new Date(1).toISOString());
  });
});

describe("seed", () => {
  test("seeds from persisted settings JSON", () => {
    const { t } = make(JSON.stringify({ "claude-a.json": "2026-01-01T00:00:00.000Z" }));
    expect(t.getCredentialLastUsed()).toEqual({ "claude-a.json": "2026-01-01T00:00:00.000Z" });
  });

  test("malformed JSON does not throw and starts empty", () => {
    const { t } = make("{not json");
    expect(() => t.getCredentialLastUsed()).not.toThrow();
    expect(t.getCredentialLastUsed()).toEqual({});
  });

  test("invalid dates in seed are dropped", () => {
    const { t } = make(JSON.stringify({ "claude-a.json": "garbage", "claude-b.json": "2026-01-01T00:00:00.000Z" }));
    expect(Object.keys(t.getCredentialLastUsed())).toEqual(["claude-b.json"]);
  });
});
