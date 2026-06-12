/**
 * Tests for custom provider validation — no server or DB needed.
 * settings is mutated directly (it's an exported plain object).
 * Run: bun test tests/customProvider.test.ts
 */
import { describe, test, expect, beforeEach } from "bun:test";
import { settings } from "../src/state";
import { isCustomProviderId, validateNewProvider } from "../src/customProviders";

const CUSTOM_PROVIDERS_KEY = "custom_providers";

function seedProviders(list: object[]) {
  settings[CUSTOM_PROVIDERS_KEY] = JSON.stringify(list);
}

function clearProviders() {
  delete settings[CUSTOM_PROVIDERS_KEY];
}

const sumopod = {
  id: "sumopod", name: "SumoPod", type: "openai",
  base_url: "https://ai.sumopod.com", api_key: "sk-test",
};
const groq = {
  id: "groq", name: "Groq", type: "openai",
  base_url: "https://api.groq.com", api_key: "sk-groq",
};

// ── isCustomProviderId ────────────────────────────────────────────────────────
describe("isCustomProviderId", () => {
  beforeEach(() => seedProviders([sumopod, groq]));

  test("known custom slug → true", () => {
    expect(isCustomProviderId("sumopod")).toBe(true);
    expect(isCustomProviderId("groq")).toBe(true);
  });

  test("reserved built-in ids → false", () => {
    expect(isCustomProviderId("inherit")).toBe(false);
    expect(isCustomProviderId("anthropic")).toBe(false);
    expect(isCustomProviderId("deepseek")).toBe(false);
    expect(isCustomProviderId("openrouter")).toBe(false);
  });

  test("unknown slug not in list → false", () => {
    expect(isCustomProviderId("nonexistent")).toBe(false);
  });

  test("empty settings → false for any slug", () => {
    clearProviders();
    expect(isCustomProviderId("sumopod")).toBe(false);
  });

  test("empty string → false", () => {
    expect(isCustomProviderId("")).toBe(false);
  });
});

// ── admin provider validation logic (replicated from admin.ts fix) ─────────────
describe("admin /token/provider validation logic", () => {
  beforeEach(() => seedProviders([sumopod, groq]));

  // Replicates the patched validation in admin.ts
  function isValidProvider(provider: string): boolean {
    const builtIn = ["inherit", "anthropic", "deepseek", "openrouter"];
    return builtIn.includes(provider) || isCustomProviderId(provider);
  }

  test("built-in providers pass", () => {
    expect(isValidProvider("inherit")).toBe(true);
    expect(isValidProvider("anthropic")).toBe(true);
    expect(isValidProvider("deepseek")).toBe(true);
    expect(isValidProvider("openrouter")).toBe(true);
  });

  test("custom provider slugs pass", () => {
    expect(isValidProvider("sumopod")).toBe(true);
    expect(isValidProvider("groq")).toBe(true);
  });

  test("arbitrary string → rejected", () => {
    expect(isValidProvider("unknown-xyz")).toBe(false);
    expect(isValidProvider("")).toBe(false);
    expect(isValidProvider("auto")).toBe(false);
  });
});

// ── validateNewProvider ───────────────────────────────────────────────────────
describe("validateNewProvider", () => {
  test("valid provider → no error", () => {
    expect(validateNewProvider(sumopod, [])).toBeNull();
  });

  test("reserved id → error", () => {
    expect(validateNewProvider({ ...sumopod, id: "anthropic" }, [])).toMatch(/reserved/);
  });

  test("duplicate id → error", () => {
    expect(validateNewProvider(sumopod, ["sumopod"])).toMatch(/already exists/);
  });

  test("invalid id format → error", () => {
    expect(validateNewProvider({ ...sumopod, id: "UPPER" }, [])).toMatch(/id must be/);
    expect(validateNewProvider({ ...sumopod, id: "a" }, [])).toMatch(/id must be/); // too short
  });

  test("invalid type → error", () => {
    expect(validateNewProvider({ ...sumopod, type: "graphql" }, [])).toMatch(/type must be/);
  });

  test("missing api_key → error", () => {
    expect(validateNewProvider({ ...sumopod, api_key: "" }, [])).toMatch(/api_key/);
  });
});
