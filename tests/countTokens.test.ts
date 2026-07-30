/**
 * Tests for count_tokens upstream forwarding logic (src/handlers/countTokens.ts).
 * Pure logic — helpers mirror the module to avoid import side-effects (upstream polling).
 * Run: bun test tests/countTokens.test.ts
 */
import { describe, test, expect } from "bun:test";

// Mirror of the response-parsing branch in handleCountTokens.
function parseUpstreamCount(ok: boolean, data: any): number {
  if (!ok) return 0;
  const n = Number(data?.input_tokens);
  return Number.isFinite(n) ? n : 0;
}

// Mirror of the credential gate: no Anthropic credential → stub 0, never call upstream.
function shouldForward(hasCredential: boolean, cred: { token: string } | null): boolean {
  if (!hasCredential) return false;
  return cred !== null;
}

describe("count_tokens upstream parsing", () => {
  test("golden path: real count from upstream is returned", () => {
    expect(parseUpstreamCount(true, { input_tokens: 19179 })).toBe(19179);
  });

  test("zero from upstream is passed through, not treated as failure", () => {
    expect(parseUpstreamCount(true, { input_tokens: 0 })).toBe(0);
  });

  test("edge case: missing input_tokens field → 0", () => {
    expect(parseUpstreamCount(true, {})).toBe(0);
  });

  test("edge case: non-numeric input_tokens → 0", () => {
    expect(parseUpstreamCount(true, { input_tokens: "many" })).toBe(0);
    expect(parseUpstreamCount(true, { input_tokens: null })).toBe(0);
  });

  test("failure mode: upstream non-OK → fall back to 0", () => {
    expect(parseUpstreamCount(false, { error: { type: "overloaded_error" } })).toBe(0);
  });

  test("numeric string from upstream is coerced", () => {
    expect(parseUpstreamCount(true, { input_tokens: "512" })).toBe(512);
  });
});

describe("count_tokens credential gate", () => {
  test("no Anthropic credential → do not forward", () => {
    expect(shouldForward(false, null)).toBe(false);
    expect(shouldForward(false, { token: "x" })).toBe(false);
  });

  test("credential flag set but no usable cred file → do not forward", () => {
    expect(shouldForward(true, null)).toBe(false);
  });

  test("credential available → forward to upstream", () => {
    expect(shouldForward(true, { token: "sk-ant-oat01-x" })).toBe(true);
  });
});
