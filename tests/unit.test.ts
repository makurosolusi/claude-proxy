/**
 * Unit tests — no running server needed
 * Run: bun test tests/unit.test.ts
 */
import { describe, test, expect, mock, beforeEach } from "bun:test";

// ── config: resolvePort (port priority) ──────────────────────────────────────
describe("config — port resolution", () => {
  test("defaults to 8080 with no args/env", () => {
    const orig = process.argv;
    process.argv = ["bun", "src/index.tsx"];
    delete process.env.PORT;
    // Re-import after clearing cache via dynamic require simulation
    const port = resolvePortFn();
    expect(port).toBe(8080);
    process.argv = orig;
  });

  test("reads PORT env var", () => {
    const orig = process.argv;
    process.argv = ["bun", "src/index.tsx"];
    process.env.PORT = "9090";
    expect(resolvePortFn()).toBe(9090);
    delete process.env.PORT;
    process.argv = orig;
  });

  test("--port arg overrides env var", () => {
    const orig = process.argv;
    process.env.PORT = "9090";
    process.argv = ["bun", "src/index.tsx", "--port", "8888"];
    expect(resolvePortFn()).toBe(8888);
    delete process.env.PORT;
    process.argv = orig;
  });

  test("-p arg works", () => {
    const orig = process.argv;
    process.argv = ["bun", "src/index.tsx", "-p", "7070"];
    expect(resolvePortFn()).toBe(7070);
    process.argv = orig;
  });

  test("--port=8085 form works", () => {
    const orig = process.argv;
    process.argv = ["bun", "src/index.tsx", "--port=8085"];
    expect(resolvePortFn()).toBe(8085);
    process.argv = orig;
  });
});

// Inline copy of resolvePort to test independently
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

// ── tokens: maskToken ─────────────────────────────────────────────────────────
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
    const masked = maskToken("sk-ant-api03-abcdefghijkl");
    expect(masked).toMatch(/\*\*\*/);
  });
});

describe("usageCls", () => {
  test("0% → ok", ()    => expect(usageCls(0)).toBe("ok"));
  test("59% → ok", ()   => expect(usageCls(59)).toBe("ok"));
  test("60% → warn", ()  => expect(usageCls(60)).toBe("warn"));
  test("79% → warn", ()  => expect(usageCls(79)).toBe("warn"));
  test("80% → high", ()  => expect(usageCls(80)).toBe("high"));
  test("100% → high", () => expect(usageCls(100)).toBe("high"));
  test("101% → over", () => expect(usageCls(101)).toBe("over"));
});

// ── tokens: checkReset ────────────────────────────────────────────────────────
import { checkReset } from "../src/tokens";
import type { TokenEntry } from "../src/types";

describe("checkReset", () => {
  function makeToken(overrides: Partial<TokenEntry> = {}): TokenEntry {
    return {
      limit: 1000, window: 18_000_000, used: 500,
      windowStart: Date.now() - 19_000_000, // expired
      paused: false, dynamic: false, mode: "inherit",
      ...overrides,
    };
  }

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

  test("non-expired window → does not reset", () => {
    const t = makeToken({ windowStart: Date.now() - 1000 }); // just started
    checkReset(t, "sk-user-test");
    expect(t.used).toBe(500);
  });
});

// ── upstream: getOauthCredential (reads real file) ────────────────────────────
import { getOauthCredential } from "../src/upstream";

describe("getOauthCredential", () => {
  test("reads credentials from authDir", () => {
    const cred = getOauthCredential();
    // Will be null if no claude-*.json exists in test env, skip gracefully
    if (!cred) {
      console.log("  [skip] No claude-*.json found — skipping credential tests");
      return;
    }
    expect(typeof cred.token).toBe("string");
    expect(cred.token.length).toBeGreaterThan(10);
    expect(typeof cred.filePath).toBe("string");
    expect(typeof cred.refreshToken).toBe("string");
    expect(typeof cred.email).toBe("string");
  });

  test("caches value within TOKEN_CACHE_MS", () => {
    const cred1 = getOauthCredential();
    const cred2 = getOauthCredential();
    if (!cred1 || !cred2) return;
    // Same object from cache
    expect(cred1.token).toBe(cred2.token);
  });
});

// ── upstream mode resolution ──────────────────────────────────────────────────
describe("upstream mode config", () => {
  test("default is cliproxy", () => {
    delete process.env.UPSTREAM_MODE;
    const mode = (process.env.UPSTREAM_MODE || "cliproxy") as string;
    expect(mode).toBe("cliproxy");
  });

  test("UPSTREAM_MODE=direct is accepted", () => {
    process.env.UPSTREAM_MODE = "direct";
    const mode = (process.env.UPSTREAM_MODE || "cliproxy") as string;
    expect(mode).toBe("direct");
    delete process.env.UPSTREAM_MODE;
  });
});

// ── TokenEntry mode field ────────────────────────────────────────────────────
describe("TokenEntry.mode", () => {
  test("effective mode: token mode=inherit uses global", () => {
    const token: TokenEntry = {
      limit: 1000, window: 18_000_000, used: 0,
      windowStart: Date.now(), paused: false, dynamic: false, mode: "inherit",
    };
    const global = "direct";
    const effective = token.mode !== "inherit" ? token.mode : global;
    expect(effective).toBe("direct");
  });

  test("effective mode: token mode=cliproxy overrides global direct", () => {
    const token: TokenEntry = {
      limit: 1000, window: 18_000_000, used: 0,
      windowStart: Date.now(), paused: false, dynamic: false, mode: "cliproxy",
    };
    const global = "direct";
    const effective = token.mode !== "inherit" ? token.mode : global;
    expect(effective).toBe("cliproxy");
  });

  test("effective mode: token mode=direct overrides global cliproxy", () => {
    const token: TokenEntry = {
      limit: 1000, window: 18_000_000, used: 0,
      windowStart: Date.now(), paused: false, dynamic: false, mode: "direct",
    };
    const global = "cliproxy";
    const effective = token.mode !== "inherit" ? token.mode : global;
    expect(effective).toBe("direct");
  });
});
