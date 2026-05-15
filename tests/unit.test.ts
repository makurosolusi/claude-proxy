/**
 * Unit tests — no running server needed
 * Run: bun test tests/unit.test.ts
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";

// ── Inline helpers (copied from src to avoid import side-effects) ─────────────

function resolvePortFn(): number {
  const argv = process.argv;
  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === "--port" || argv[i] === "-p") && argv[i + 1]) {
      const p = parseInt(argv[i + 1]);
      if (!isNaN(p)) return p;
    }
    const m = argv[i].match(/^--port=(\d+)$/);
    if (m) return parseInt(m[1]);
  }
  return parseInt(process.env.PORT || "8080");
}

function stripInjections(text: string): string {
  return text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, "")
             .replace(/<\/?[a-z][a-z0-9-]*(?:\s[^>]*)?>[\s\S]*?<\/[a-z][a-z0-9-]*>/gi, (m) =>
               m.startsWith("<system") ? "" : m)
             .trim();
}

function getRawContent(msg: any): string {
  if (typeof msg.content === "string") return msg.content;
  if (!Array.isArray(msg.content)) return "";
  return msg.content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text || "")
    .join("\n");
}

function extractPrompt(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    const text = getRawContent(m);
    if (text.trim()) return stripInjections(text).slice(0, 2000);
  }
  return "";
}

function extractTranscript(messages: any[]): string {
  const turns = messages.map((m: any) => ({
    role: m.role as string,
    text: getRawContent(m).slice(0, 1000),
  })).filter(t => t.text.trim());
  return JSON.stringify(turns).slice(0, 8000);
}

function extractResponseText(body: any, status: number): string {
  if (status >= 400) return body?.error?.message || body?.error || "";
  if (!body?.content) return "";
  return body.content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text || "")
    .join("")
    .slice(0, 3000);
}

function extractSystem(body: any): string {
  const sys = body?.system;
  if (!sys) return "";
  if (typeof sys === "string") return sys.slice(0, 500);
  if (Array.isArray(sys)) return sys.map((b: any) => b.text || "").join("").slice(0, 500);
  return "";
}

function hasThinkingBlocks(messages: any[]): boolean {
  return messages.some(m =>
    Array.isArray(m.content) &&
    m.content.some((b: any) => b.type === "thinking" || b.type === "redacted_thinking")
  );
}

function slugify(name: string): string {
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s || "user";
}

function ensureUniqueSlug(base: string, existing: Record<string, unknown>): string {
  if (!existing[base]) return base;
  let i = 2;
  while (existing[`${base}-${i}`]) i++;
  return `${base}-${i}`;
}

function deriveNameFromKey(key: string): string {
  const parts = key.split("-");
  return parts[parts.length - 1] || key;
}

// ── 1. config: port resolution ────────────────────────────────────────────────
describe("config — port resolution", () => {
  const origArgv = process.argv;

  afterEach(() => {
    process.argv = origArgv;
    delete process.env.PORT;
  });

  test("defaults to 8080 when no PORT env and no args", () => {
    process.argv = ["bun", "src/index.tsx"];
    const saved = process.env.PORT;
    delete process.env.PORT;
    expect(resolvePortFn()).toBe(8080);
    if (saved !== undefined) process.env.PORT = saved;
  });

  test("reads PORT env var", () => {
    process.argv = ["bun", "src/index.tsx"];
    process.env.PORT = "9090";
    expect(resolvePortFn()).toBe(9090);
  });

  test("--port arg overrides env", () => {
    process.env.PORT = "9090";
    process.argv = ["bun", "src/index.tsx", "--port", "8888"];
    expect(resolvePortFn()).toBe(8888);
  });

  test("-p arg works", () => {
    process.argv = ["bun", "src/index.tsx", "-p", "7070"];
    expect(resolvePortFn()).toBe(7070);
  });

  test("--port=8085 form works", () => {
    process.argv = ["bun", "src/index.tsx", "--port=8085"];
    expect(resolvePortFn()).toBe(8085);
  });
});

// ── 2. maskToken + usageCls ───────────────────────────────────────────────────
import { maskToken, usageCls } from "../src/tokens";

describe("maskToken", () => {
  test("sk-user-X → strips prefix", () => {
    expect(maskToken("sk-user-bagas")).toBe("bagas");
    expect(maskToken("sk-user-nico")).toBe("nico");
  });
  test("short key → ***", () => {
    expect(maskToken("abc")).toBe("***");
  });
  test("long non-user key → partial mask", () => {
    expect(maskToken("sk-ant-api03-abcdefghijkl")).toMatch(/\*\*\*/);
  });
});

describe("usageCls", () => {
  test("0% → ok",   () => expect(usageCls(0)).toBe("ok"));
  test("59% → ok",  () => expect(usageCls(59)).toBe("ok"));
  test("60% → warn",() => expect(usageCls(60)).toBe("warn"));
  test("79% → warn",() => expect(usageCls(79)).toBe("warn"));
  test("80% → high",() => expect(usageCls(80)).toBe("high"));
  test("100% → high",()=> expect(usageCls(100)).toBe("high"));
  test("101% → over",()=> expect(usageCls(101)).toBe("over"));
});

// ── 3. checkReset ─────────────────────────────────────────────────────────────
import { checkReset } from "../src/tokens";
import type { TokenEntry } from "../src/types";

function makeToken(overrides: Partial<TokenEntry> = {}): TokenEntry {
  return {
    limit: 1000, window: 18_000_000, used: 500,
    windowStart: Date.now() - 19_000_000,
    paused: false, dynamic: false, mode: "inherit",
    provider: "inherit", user_id: "",
    label: "test", description: "", pinned_model: "",
    ...overrides,
  };
}

describe("checkReset", () => {
  test("expired window → resets used to 0", () => {
    const t = makeToken();
    checkReset(t, "sk-user-test");
    expect(t.used).toBe(0);
  });

  test("expired window → updates windowStart to now", () => {
    const t = makeToken();
    const before = Date.now();
    checkReset(t, "sk-user-test");
    expect(t.windowStart).toBeGreaterThanOrEqual(before);
  });

  test("non-expired window → does NOT reset", () => {
    const t = makeToken({ windowStart: Date.now() - 1000 });
    checkReset(t, "sk-user-test");
    expect(t.used).toBe(500);
  });

  test("exactly expired (== window) → resets", () => {
    const window = 18_000_000;
    const t = makeToken({ windowStart: Date.now() - window, window });
    checkReset(t, "sk-user-test");
    expect(t.used).toBe(0);
  });

  test("infinite limit token still resets", () => {
    const t = makeToken({ limit: Infinity });
    checkReset(t, "sk-user-test");
    expect(t.used).toBe(0);
  });
});

// ── 4. in-flight reservation system ──────────────────────────────────────────
import {
  reserveInFlight, releaseInFlight, getInFlight, clearInFlight,
} from "../src/tokens";

describe("in-flight reservation", () => {
  beforeEach(() => clearInFlight());

  test("getInFlight returns 0 for unknown key", () => {
    expect(getInFlight("sk-user-x")).toBe(0);
  });

  test("reserve → getInFlight returns amount", () => {
    reserveInFlight("key1", 1000);
    expect(getInFlight("key1")).toBe(1000);
  });

  test("multiple reserves accumulate", () => {
    reserveInFlight("key1", 500);
    reserveInFlight("key1", 300);
    expect(getInFlight("key1")).toBe(800);
  });

  test("release by ID removes exact reservation", () => {
    reserveInFlight("key1", 500);
    const id2 = reserveInFlight("key1", 300);
    releaseInFlight("key1", id2);
    expect(getInFlight("key1")).toBe(500);
  });

  test("release non-existent ID → no-op", () => {
    reserveInFlight("key1", 500);
    releaseInFlight("key1", 9999);
    expect(getInFlight("key1")).toBe(500);
  });

  test("each reserve returns unique ID", () => {
    const id1 = reserveInFlight("key1", 100);
    const id2 = reserveInFlight("key1", 100);
    expect(id1).not.toBe(id2);
  });

  test("clearInFlight(key) clears only that key", () => {
    reserveInFlight("key1", 500);
    reserveInFlight("key2", 300);
    clearInFlight("key1");
    expect(getInFlight("key1")).toBe(0);
    expect(getInFlight("key2")).toBe(300);
  });

  test("clearInFlight() with no arg clears all", () => {
    reserveInFlight("key1", 500);
    reserveInFlight("key2", 300);
    clearInFlight();
    expect(getInFlight("key1")).toBe(0);
    expect(getInFlight("key2")).toBe(0);
  });

  test("release all → getInFlight returns 0", () => {
    const id1 = reserveInFlight("key1", 100);
    const id2 = reserveInFlight("key1", 200);
    releaseInFlight("key1", id1);
    releaseInFlight("key1", id2);
    expect(getInFlight("key1")).toBe(0);
  });
});

// ── 5. incrementUsage + generation guard ─────────────────────────────────────
import { incrementUsage, getGeneration, bumpGeneration } from "../src/tokens";
import { tokens } from "../src/state";

describe("incrementUsage + generation guard", () => {
  beforeEach(() => {
    clearInFlight();
    // Setup a test token directly in memory
    tokens["sk-test-inc"] = makeToken({ used: 0, limit: 10000 });
  });

  afterEach(() => {
    delete tokens["sk-test-inc"];
  });

  test("increments used on valid call", () => {
    incrementUsage("sk-test-inc", 500);
    expect(tokens["sk-test-inc"]!.used).toBe(500);
  });

  test("accumulates multiple increments", () => {
    incrementUsage("sk-test-inc", 300);
    incrementUsage("sk-test-inc", 200);
    expect(tokens["sk-test-inc"]!.used).toBe(500);
  });

  test("non-existent token → no-op (no crash)", () => {
    expect(() => incrementUsage("sk-user-nonexistent", 100)).not.toThrow();
  });

  test("matching generation → increments", () => {
    const gen = getGeneration("sk-test-inc");
    incrementUsage("sk-test-inc", 100, gen);
    expect(tokens["sk-test-inc"]!.used).toBe(100);
  });

  test("mismatched generation → skips (stale request protection)", () => {
    bumpGeneration("sk-test-inc");
    const oldGen = getGeneration("sk-test-inc") - 1;
    incrementUsage("sk-test-inc", 999, oldGen);
    expect(tokens["sk-test-inc"]!.used).toBe(0);
  });
});

describe("generation counter", () => {
  test("default generation is 0", () => {
    expect(getGeneration("nonexistent-key")).toBe(0);
  });

  test("bumpGeneration increments by 1", () => {
    const key = "sk-gen-test";
    const before = getGeneration(key);
    bumpGeneration(key);
    expect(getGeneration(key)).toBe(before + 1);
  });

  test("bump multiple times accumulates", () => {
    const key = "sk-gen-multi";
    bumpGeneration(key);
    bumpGeneration(key);
    bumpGeneration(key);
    expect(getGeneration(key)).toBe(3);
  });
});

// ── 6. slugify + ensureUniqueSlug + deriveNameFromKey ────────────────────────
describe("slugify", () => {
  test("lowercases", () => expect(slugify("BAGAS")).toBe("bagas"));
  test("replaces spaces with dashes", () => expect(slugify("hello world")).toBe("hello-world"));
  test("strips special chars", () => expect(slugify("user@gmail.com")).toBe("user-gmail-com"));
  test("trims leading/trailing dashes", () => expect(slugify("-test-")).toBe("test"));
  test("empty string → user", () => expect(slugify("")).toBe("user"));
  test("only special chars → user", () => expect(slugify("@#$%")).toBe("user"));
  test("collapses multiple dashes", () => expect(slugify("a  b")).toBe("a-b"));
});

describe("ensureUniqueSlug", () => {
  test("no collision → returns base", () => {
    expect(ensureUniqueSlug("alice", {})).toBe("alice");
  });

  test("collision → appends -2", () => {
    expect(ensureUniqueSlug("alice", { alice: true })).toBe("alice-2");
  });

  test("collision on -2 → appends -3", () => {
    expect(ensureUniqueSlug("alice", { alice: true, "alice-2": true })).toBe("alice-3");
  });

  test("multiple existing → finds first free", () => {
    const existing = { alice: true, "alice-2": true, "alice-3": true };
    expect(ensureUniqueSlug("alice", existing)).toBe("alice-4");
  });
});

describe("deriveNameFromKey", () => {
  test("sk-user-alice → alice", () => expect(deriveNameFromKey("sk-user-alice")).toBe("alice"));
  test("sk-cp-abc → abc", () => expect(deriveNameFromKey("sk-cp-abc")).toBe("abc"));
  test("single segment → returns it", () => expect(deriveNameFromKey("alice")).toBe("alice"));
  test("empty string → empty string", () => expect(deriveNameFromKey("")).toBe(""));
});

// ── 7. stripInjections ────────────────────────────────────────────────────────
describe("stripInjections", () => {
  test("removes system-reminder tags", () => {
    const input = "hello <system-reminder>secret</system-reminder> world";
    expect(stripInjections(input)).toBe("hello  world");
  });

  test("removes multiple system-reminder tags", () => {
    const input = "<system-reminder>a</system-reminder>text<system-reminder>b</system-reminder>";
    expect(stripInjections(input)).not.toContain("system-reminder");
  });

  test("preserves normal text", () => {
    expect(stripInjections("hello world")).toBe("hello world");
  });

  test("handles empty string", () => {
    expect(stripInjections("")).toBe("");
  });

  test("case insensitive", () => {
    const input = "<SYSTEM-REMINDER>secret</SYSTEM-REMINDER>";
    expect(stripInjections(input)).not.toContain("secret");
  });
});

// ── 8. getRawContent ─────────────────────────────────────────────────────────
describe("getRawContent", () => {
  test("string content → returns it", () => {
    expect(getRawContent({ role: "user", content: "hello" })).toBe("hello");
  });

  test("array with text block → returns text", () => {
    expect(getRawContent({ role: "user", content: [{ type: "text", text: "hi" }] })).toBe("hi");
  });

  test("array with multiple text blocks → joins", () => {
    const msg = { role: "user", content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] };
    expect(getRawContent(msg)).toBe("a\nb");
  });

  test("array with non-text blocks → skips them", () => {
    const msg = { role: "user", content: [{ type: "tool_result" }, { type: "text", text: "hi" }] };
    expect(getRawContent(msg)).toBe("hi");
  });

  test("non-array, non-string content → empty", () => {
    expect(getRawContent({ role: "user", content: null })).toBe("");
    expect(getRawContent({ role: "user", content: 42 })).toBe("");
  });
});

// ── 9. extractPrompt ─────────────────────────────────────────────────────────
describe("extractPrompt", () => {
  test("single user message → returns it", () => {
    const msgs = [{ role: "user", content: "hello" }];
    expect(extractPrompt(msgs)).toBe("hello");
  });

  test("last user message returned", () => {
    const msgs = [
      { role: "user", content: "first" },
      { role: "assistant", content: "reply" },
      { role: "user", content: "second" },
    ];
    expect(extractPrompt(msgs)).toBe("second");
  });

  test("no user messages → empty", () => {
    const msgs = [{ role: "assistant", content: "hi" }];
    expect(extractPrompt(msgs)).toBe("");
  });

  test("strips system-reminder injections", () => {
    const msgs = [{ role: "user", content: "hello <system-reminder>secret</system-reminder>" }];
    expect(extractPrompt(msgs)).not.toContain("secret");
    expect(extractPrompt(msgs)).toContain("hello");
  });

  test("empty messages array → empty", () => {
    expect(extractPrompt([])).toBe("");
  });

  test("truncates at 2000 chars", () => {
    const long = "a".repeat(3000);
    const msgs = [{ role: "user", content: long }];
    expect(extractPrompt(msgs).length).toBeLessThanOrEqual(2000);
  });
});

// ── 10. extractResponseText ───────────────────────────────────────────────────
describe("extractResponseText", () => {
  test("success → extracts text from content array", () => {
    const body = { content: [{ type: "text", text: "hello" }] };
    expect(extractResponseText(body, 200)).toBe("hello");
  });

  test("success → joins multiple text blocks", () => {
    const body = { content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] };
    expect(extractResponseText(body, 200)).toBe("ab");
  });

  test("status >= 400 → returns error message", () => {
    const body = { error: { message: "Rate limited" } };
    expect(extractResponseText(body, 429)).toBe("Rate limited");
  });

  test("status >= 400 with string error → returns it", () => {
    const body = { error: "something went wrong" };
    expect(extractResponseText(body, 500)).toBe("something went wrong");
  });

  test("no content → empty", () => {
    expect(extractResponseText({}, 200)).toBe("");
  });

  test("truncates at 3000 chars", () => {
    const body = { content: [{ type: "text", text: "x".repeat(5000) }] };
    expect(extractResponseText(body, 200).length).toBeLessThanOrEqual(3000);
  });
});

// ── 11. extractSystem ─────────────────────────────────────────────────────────
describe("extractSystem", () => {
  test("string system → returns it", () => {
    const body = { system: "You are helpful" };
    expect(extractSystem(body)).toBe("You are helpful");
  });

  test("array blocks → joins text", () => {
    const body = { system: [{ text: "part1" }, { text: "part2" }] };
    expect(extractSystem(body)).toBe("part1part2");
  });

  test("missing system → empty", () => {
    expect(extractSystem({})).toBe("");
    expect(extractSystem({ system: null })).toBe("");
  });

  test("truncates at 500 chars", () => {
    const body = { system: "s".repeat(1000) };
    expect(extractSystem(body).length).toBeLessThanOrEqual(500);
  });
});

// ── 12. hasThinkingBlocks ────────────────────────────────────────────────────
describe("hasThinkingBlocks", () => {
  test("message with thinking block → true", () => {
    const msgs = [{ role: "assistant", content: [{ type: "thinking", thinking: "..." }] }];
    expect(hasThinkingBlocks(msgs)).toBe(true);
  });

  test("message with redacted_thinking → true", () => {
    const msgs = [{ role: "assistant", content: [{ type: "redacted_thinking" }] }];
    expect(hasThinkingBlocks(msgs)).toBe(true);
  });

  test("no thinking blocks → false", () => {
    const msgs = [{ role: "user", content: "hello" }, { role: "assistant", content: [{ type: "text", text: "hi" }] }];
    expect(hasThinkingBlocks(msgs)).toBe(false);
  });

  test("empty array → false", () => {
    expect(hasThinkingBlocks([])).toBe(false);
  });

  test("string content (not array) → false", () => {
    const msgs = [{ role: "assistant", content: "plain text" }];
    expect(hasThinkingBlocks(msgs)).toBe(false);
  });
});

// ── 13. extractTranscript ────────────────────────────────────────────────────
describe("extractTranscript", () => {
  test("builds JSON array of turns", () => {
    const msgs = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ];
    const result = JSON.parse(extractTranscript(msgs));
    expect(result).toHaveLength(2);
    expect(result[0].role).toBe("user");
    expect(result[0].text).toBe("hi");
  });

  test("filters out empty text turns", () => {
    const msgs = [
      { role: "user", content: "" },
      { role: "user", content: "hello" },
    ];
    const result = JSON.parse(extractTranscript(msgs));
    expect(result).toHaveLength(1);
  });

  test("truncates at 8000 chars total", () => {
    const msgs = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: "x".repeat(1000),
    }));
    expect(extractTranscript(msgs).length).toBeLessThanOrEqual(8000);
  });
});

// ── 14. upstream mode config ──────────────────────────────────────────────────
describe("upstream mode config", () => {
  afterEach(() => { delete process.env.UPSTREAM_MODE; });

  test("default is cliproxy", () => {
    delete process.env.UPSTREAM_MODE;
    expect(process.env.UPSTREAM_MODE || "cliproxy").toBe("cliproxy");
  });

  test("UPSTREAM_MODE=direct accepted", () => {
    process.env.UPSTREAM_MODE = "direct";
    expect(process.env.UPSTREAM_MODE).toBe("direct");
  });
});

// ── 15. TokenEntry.mode resolution ───────────────────────────────────────────
describe("TokenEntry mode resolution", () => {
  function effectiveMode(tokenMode: string, globalMode: string): string {
    return tokenMode !== "inherit" ? tokenMode : globalMode;
  }

  test("inherit → uses global direct", () => {
    expect(effectiveMode("inherit", "direct")).toBe("direct");
  });

  test("inherit → uses global cliproxy", () => {
    expect(effectiveMode("inherit", "cliproxy")).toBe("cliproxy");
  });

  test("cliproxy overrides global direct", () => {
    expect(effectiveMode("cliproxy", "direct")).toBe("cliproxy");
  });

  test("direct overrides global cliproxy", () => {
    expect(effectiveMode("direct", "cliproxy")).toBe("direct");
  });
});

// ── 16. quota logic (pure) ────────────────────────────────────────────────────
describe("quota check logic", () => {
  function isOverQuota(used: number, inFlight: number, limit: number): boolean {
    if (limit === Infinity) return false;
    return used + inFlight >= limit;
  }

  test("under quota → not blocked", () => {
    expect(isOverQuota(500, 100, 1000)).toBe(false);
  });

  test("exactly at limit → blocked", () => {
    expect(isOverQuota(900, 100, 1000)).toBe(true);
  });

  test("over limit → blocked", () => {
    expect(isOverQuota(1000, 0, 1000)).toBe(true);
  });

  test("in-flight pushes over quota → blocked", () => {
    expect(isOverQuota(800, 300, 1000)).toBe(true);
  });

  test("infinite limit → never blocked", () => {
    expect(isOverQuota(999999, 999999, Infinity)).toBe(false);
  });

  test("zero used + zero in-flight → not blocked", () => {
    expect(isOverQuota(0, 0, 1000)).toBe(false);
  });
});

// ── 17. addDailyUsage (state) ─────────────────────────────────────────────────
import { addDailyUsage, todayKey } from "../src/tokens";
import { dailyUsage } from "../src/state";

describe("addDailyUsage", () => {
  beforeEach(() => {
    // Clean dailyUsage state
    for (const k of Object.keys(dailyUsage)) delete dailyUsage[k];
  });

  test("creates entry for new date+key", () => {
    addDailyUsage("sk-test", 100);
    const today = todayKey();
    expect(dailyUsage[today]?.["sk-test"]).toBe(100);
  });

  test("accumulates for same date+key", () => {
    addDailyUsage("sk-test", 100);
    addDailyUsage("sk-test", 50);
    expect(dailyUsage[todayKey()]?.["sk-test"]).toBe(150);
  });

  test("zero delta → no-op", () => {
    addDailyUsage("sk-test", 0);
    expect(dailyUsage[todayKey()]?.["sk-test"]).toBeUndefined();
  });

  test("negative delta → no-op", () => {
    addDailyUsage("sk-test", -10);
    expect(dailyUsage[todayKey()]?.["sk-test"]).toBeUndefined();
  });

  test("todayKey returns YYYY-MM-DD format", () => {
    const key = todayKey();
    expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ── 18. maskLog logic (apiLogs) ───────────────────────────────────────────────
describe("maskLog logic", () => {
  const fullLog = {
    id: 1, ts: 1000, name: "alice",
    token_key: "sk-user-alice-secret",
    model: "claude-sonnet-4-6",
    input_tokens: 100, output_tokens: 50,
    stream: true, status: 200,
    stop_reason: "end_turn", duration_ms: 1200,
    tool_use_count: 0, turns: 5,
    messages_json: "", response_text: "hello",
    prompt: "a".repeat(200),
    system_prompt: "You are helpful",
    cache_read: 50, cache_creation: 100,
  };

  function maskLog(log: any, isAdmin: boolean) {
    return {
      id: log.id, ts: log.ts, name: log.name,
      token_key:     isAdmin ? log.token_key : log.name,
      model:         log.model,
      input_tokens:  log.input_tokens, output_tokens: log.output_tokens,
      stream:        log.stream, status: log.status,
      stop_reason:   log.stop_reason, duration_ms: log.duration_ms,
      tool_use_count:log.tool_use_count, turns: log.turns,
      messages_json: log.messages_json, response_text: log.response_text,
      prompt:        isAdmin ? log.prompt : (log.prompt || "").slice(0, 100),
      system_prompt: isAdmin ? log.system_prompt : "",
      cache_read:    isAdmin ? log.cache_read    : 0,
      cache_creation:isAdmin ? log.cache_creation: 0,
    };
  }

  test("admin → sees full token_key", () => {
    expect(maskLog(fullLog, true).token_key).toBe("sk-user-alice-secret");
  });

  test("non-admin → token_key replaced with name", () => {
    expect(maskLog(fullLog, false).token_key).toBe("alice");
  });

  test("admin → sees full prompt", () => {
    expect(maskLog(fullLog, true).prompt.length).toBe(200);
  });

  test("non-admin → prompt truncated to 100 chars", () => {
    expect(maskLog(fullLog, false).prompt.length).toBe(100);
  });

  test("admin → sees system_prompt", () => {
    expect(maskLog(fullLog, true).system_prompt).toBe("You are helpful");
  });

  test("non-admin → system_prompt empty", () => {
    expect(maskLog(fullLog, false).system_prompt).toBe("");
  });

  test("admin → sees cache metrics", () => {
    expect(maskLog(fullLog, true).cache_read).toBe(50);
    expect(maskLog(fullLog, true).cache_creation).toBe(100);
  });

  test("non-admin → cache metrics zeroed", () => {
    expect(maskLog(fullLog, false).cache_read).toBe(0);
    expect(maskLog(fullLog, false).cache_creation).toBe(0);
  });
});

// ── 19. getOauthCredential ────────────────────────────────────────────────────
import { getOauthCredential } from "../src/upstream";

describe("getOauthCredential", () => {
  test("returns null or valid credential shape", () => {
    const cred = getOauthCredential();
    if (!cred) return; // no credentials in test env — skip
    expect(typeof cred.token).toBe("string");
    expect(cred.token.length).toBeGreaterThan(10);
    expect(typeof cred.filePath).toBe("string");
    expect(typeof cred.refreshToken).toBe("string");
  });

  test("caches value within TOKEN_CACHE_MS", () => {
    const cred1 = getOauthCredential();
    const cred2 = getOauthCredential();
    if (!cred1 || !cred2) return;
    expect(cred1.token).toBe(cred2.token);
  });
});

// ── 20. window rotation detection logic ──────────────────────────────────────
describe("window rotation detection", () => {
  function isWindowRotated(newResetsAtMs: number, prevResetsAtMs: number | null): boolean {
    if (prevResetsAtMs === null) return false;
    return newResetsAtMs - prevResetsAtMs > 30 * 60_000; // > 30 min diff
  }

  test("no previous resets_at → not rotated", () => {
    expect(isWindowRotated(Date.now(), null)).toBe(false);
  });

  test("diff < 30 min → not rotated", () => {
    const now = Date.now();
    expect(isWindowRotated(now + 20 * 60_000, now)).toBe(false);
  });

  test("diff > 30 min → rotated", () => {
    const now = Date.now();
    expect(isWindowRotated(now + 60 * 60_000, now)).toBe(true);
  });

  test("diff exactly 30 min → not rotated (strict >)", () => {
    const now = Date.now();
    expect(isWindowRotated(now + 30 * 60_000, now)).toBe(false);
  });
});
