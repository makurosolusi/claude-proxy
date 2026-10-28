/**
 * Tests for modelAllowlist.ts — pure, no DB/server
 * Run: bun test tests/modelAllowlist.test.ts
 */
import { describe, test, expect } from "bun:test";
import { resolveModel, normalizeAllowed, derivePinnedModel } from "../src/modelAllowlist";

const HAIKU  = "claude-haiku-4-5";
const SONNET = "claude-sonnet-4-6";
const OPUS   = "claude-opus-5";

describe("resolveModel", () => {
  test("requested model listed → passes through unchanged", () => {
    expect(resolveModel(SONNET, [HAIKU, SONNET, OPUS])).toEqual({ model: SONNET, redirected: false });
    expect(resolveModel(HAIKU,  [HAIKU, SONNET, OPUS])).toEqual({ model: HAIKU,  redirected: false });
    expect(resolveModel(OPUS,   [HAIKU, SONNET, OPUS])).toEqual({ model: OPUS,   redirected: false });
  });

  test("empty allowlist → anything passes", () => {
    expect(resolveModel(OPUS, [])).toEqual({ model: OPUS, redirected: false });
    expect(resolveModel("whatever-model", [])).toEqual({ model: "whatever-model", redirected: false });
  });

  test("single entry → legacy pin behavior (always that model)", () => {
    expect(resolveModel(OPUS,   [HAIKU])).toEqual({ model: HAIKU, redirected: true });
    expect(resolveModel(HAIKU,  [HAIKU])).toEqual({ model: HAIKU, redirected: false });
  });

  test("unlisted model → redirected to allowed_models[0]", () => {
    expect(resolveModel("claude-opus-4-8", [SONNET, HAIKU])).toEqual({ model: SONNET, redirected: true });
  });

  test("match is case-sensitive", () => {
    expect(resolveModel("CLAUDE-HAIKU-4-5", [HAIKU, SONNET])).toEqual({ model: HAIKU, redirected: true });
  });

  test("blank/whitespace entries never become a redirect target", () => {
    expect(resolveModel(OPUS, ["", "  ", SONNET])).toEqual({ model: SONNET, redirected: true });
    expect(resolveModel(OPUS, ["", "   "])).toEqual({ model: OPUS, redirected: false });
  });
});

describe("normalizeAllowed", () => {
  test("trims, drops empties, dedupes, keeps order", () => {
    expect(normalizeAllowed([" " + SONNET, "", HAIKU + "  ", SONNET, "   "])).toEqual([SONNET, HAIKU]);
  });

  test("accepts comma-separated string from admin form field", () => {
    expect(normalizeAllowed(`${HAIKU}, ${SONNET} ,${OPUS}`)).toEqual([HAIKU, SONNET, OPUS]);
    expect(normalizeAllowed("")).toEqual([]);
    expect(normalizeAllowed(" , , ")).toEqual([]);
  });

  test("already-clean input is unchanged", () => {
    expect(normalizeAllowed([HAIKU, SONNET])).toEqual([HAIKU, SONNET]);
  });
});

describe("derivePinnedModel", () => {
  test("exactly one model → that model", () => {
    expect(derivePinnedModel([SONNET])).toBe(SONNET);
    expect(derivePinnedModel(["", SONNET, " "])).toBe(SONNET);
  });

  test("empty or multiple → empty string", () => {
    expect(derivePinnedModel([])).toBe("");
    expect(derivePinnedModel([HAIKU, SONNET])).toBe("");
    expect(derivePinnedModel([SONNET, SONNET])).toBe(SONNET); // dedupe collapses to one
  });
});
