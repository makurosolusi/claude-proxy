/**
 * Tests for messageSanitizer.ts — no server needed
 * Run: bun test tests/messageSanitizer.test.ts
 */
import { describe, test, expect } from "bun:test";
import {
  getCapabilities,
  sanitizeRequestBody,
  stripAllThinking,
  isThinkingIncompatibleError,
} from "../src/messageSanitizer";

// ── getCapabilities ───────────────────────────────────────────────────────────
describe("getCapabilities", () => {
  test("openai custom type → rejects all thinking", () => {
    const caps = getCapabilities("custom-x", "gpt-4o", "openai");
    expect(caps.acceptsThinkingBlocks).toBe(false);
    expect(caps.acceptsThinkingParam).toBe(false);
  });

  test("haiku model → rejects all thinking", () => {
    const caps = getCapabilities("anthropic", "claude-haiku-4-5-20251001");
    expect(caps.acceptsThinkingBlocks).toBe(false);
    expect(caps.acceptsThinkingParam).toBe(false);
  });

  test("haiku family regex → rejects all thinking", () => {
    const caps = getCapabilities("anthropic", "claude-haiku-99");
    expect(caps.acceptsThinkingBlocks).toBe(false);
    expect(caps.acceptsThinkingParam).toBe(false);
  });

  test("fable model → accepts thinking param + blocks but rejects disabled", () => {
    const caps = getCapabilities("anthropic", "claude-fable-5");
    expect(caps.acceptsThinkingBlocks).toBe(true);
    expect(caps.acceptsThinkingParam).toBe(true);
    expect(caps.rejectsThinkingDisabled).toBe(true);
  });

  test("fable-5 (short id) → rejectsThinkingDisabled", () => {
    const caps = getCapabilities("anthropic", "fable-5");
    expect(caps.rejectsThinkingDisabled).toBe(true);
  });

  test("fable on non-anthropic provider → no rejectsThinkingDisabled (provider check)", () => {
    const caps = getCapabilities("openrouter", "fable-5");
    expect(caps.rejectsThinkingDisabled).toBeFalsy();
  });

  test("opus model → accepts everything, no rejectsThinkingDisabled", () => {
    const caps = getCapabilities("anthropic", "claude-opus-4-8");
    expect(caps.acceptsThinkingBlocks).toBe(true);
    expect(caps.acceptsThinkingParam).toBe(true);
    expect(caps.rejectsThinkingDisabled).toBeFalsy();
  });

  test("unknown model → default keep (retry safety net handles it)", () => {
    const caps = getCapabilities("anthropic", "");
    expect(caps.acceptsThinkingBlocks).toBe(true);
    expect(caps.acceptsThinkingParam).toBe(true);
  });
});

// ── sanitizeRequestBody — Fable: strip thinking.type.disabled ─────────────────
describe("sanitizeRequestBody — fable thinking.type.disabled", () => {
  const fableCaps = getCapabilities("anthropic", "claude-fable-5");

  test("thinking.type.disabled → deleted, thinkingParamDropped=true", () => {
    const body = { model: "claude-fable-5", thinking: { type: "disabled" } };
    const stats = sanitizeRequestBody(body, fableCaps);
    expect(body.thinking).toBeUndefined();
    expect(stats.thinkingParamDropped).toBe(true);
  });

  test("thinking.type.enabled preserved for fable", () => {
    const body = { model: "claude-fable-5", thinking: { type: "enabled", budget_tokens: 4000 } };
    const stats = sanitizeRequestBody(body, fableCaps);
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 4000 });
    expect(stats.thinkingParamDropped).toBe(false);
  });

  test("no thinking field → no-op", () => {
    const body = { model: "claude-fable-5", messages: [] };
    const stats = sanitizeRequestBody(body, fableCaps);
    expect(stats.thinkingParamDropped).toBe(false);
  });

  test("thinking blocks preserved for fable (fable supports them)", () => {
    const body = {
      model: "claude-fable-5",
      messages: [
        { role: "assistant", content: [{ type: "thinking", thinking: "..." }, { type: "text", text: "hi" }] },
      ],
    };
    sanitizeRequestBody(body, fableCaps);
    expect(body.messages[0].content).toHaveLength(2); // thinking block not stripped
  });
});

// ── sanitizeRequestBody — haiku: strip everything ────────────────────────────
describe("sanitizeRequestBody — haiku rejects all thinking", () => {
  const haikuCaps = getCapabilities("anthropic", "claude-haiku-4-5");

  test("strips thinking param", () => {
    const body = { thinking: { type: "disabled" } };
    sanitizeRequestBody(body, haikuCaps);
    expect(body.thinking).toBeUndefined();
  });

  test("strips thinking blocks from assistant messages", () => {
    const body = {
      messages: [
        { role: "assistant", content: [{ type: "thinking", thinking: "..." }, { type: "text", text: "hi" }] },
      ],
    };
    const stats = sanitizeRequestBody(body, haikuCaps);
    expect(body.messages[0].content).toHaveLength(1);
    expect(body.messages[0].content[0].type).toBe("text");
    expect(stats.thinkingBlocks).toBe(1);
  });
});

// ── stripAllThinking ──────────────────────────────────────────────────────────
describe("stripAllThinking", () => {
  test("removes thinking param and blocks unconditionally", () => {
    const body = {
      thinking: { type: "enabled", budget_tokens: 4000 },
      messages: [
        { role: "assistant", content: [{ type: "thinking", thinking: "..." }, { type: "text", text: "hi" }] },
      ],
    };
    const stats = stripAllThinking(body);
    expect(body.thinking).toBeUndefined();
    expect(body.messages[0].content).toHaveLength(1);
    expect(stats.thinkingParamDropped).toBe(true);
    expect(stats.thinkingBlocks).toBe(1);
  });
});

// ── isThinkingIncompatibleError ───────────────────────────────────────────────
describe("isThinkingIncompatibleError", () => {
  test("non-400 status → false", () => {
    expect(isThinkingIncompatibleError(429, { error: { message: "thinking.type.disabled is not supported" } })).toBe(false);
  });

  test("Fable error: thinking.type.disabled is not supported → true", () => {
    const body = {
      error: {
        message: '"thinking.type.disabled" is not supported for this model. Thinking defaults to adaptive mode when not specified; use "thinking.type.enabled" with "budget_tokens" for extended thinking.',
      },
    };
    expect(isThinkingIncompatibleError(400, body)).toBe(true);
  });

  test("invalid signature error → true", () => {
    expect(isThinkingIncompatibleError(400, { error: { message: "Invalid `signature` in thinking block" } })).toBe(true);
  });

  test("adaptive thinking error → true", () => {
    expect(isThinkingIncompatibleError(400, { error: { message: "adaptive thinking not available here" } })).toBe(true);
  });

  test("generic 400 unrelated → false", () => {
    expect(isThinkingIncompatibleError(400, { error: { message: "max_tokens exceeded" } })).toBe(false);
  });

  test("empty body → false", () => {
    expect(isThinkingIncompatibleError(400, {})).toBe(false);
  });
});
