/**
 * Endpoint-layer tests for POST /admin/token/swap-model.
 * Pure swap logic lives in tests/modelAllowlist.test.ts — this file covers the
 * filtering, touch/skip decisions, count accuracy and write consistency.
 *
 * Run: bun test tests/adminTokenModels.test.ts (requires PostgreSQL)
 */
import { describe, test, expect, beforeAll, beforeEach, afterAll } from "bun:test";

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgresql://bip@localhost:5432/claude_proxy";
}

import { prisma } from "../src/prisma";
import { tokens, dbInsertToken } from "../src/state";
import { handleTokenAllowedModels } from "../src/handlers/adminTokenModels";
import type { TokenEntry } from "../src/types";

const PREFIX = "sk-test-swap-";
const UID_A  = "test-user-swap-a";
const UID_B  = "test-user-swap-b";

const K_MULTI_A = `${PREFIX}multi-a`;
const K_MULTI_B = `${PREFIX}multi-b`;
const K_NOMATCH = `${PREFIX}nomatch`;
const K_FREE    = `${PREFIX}free`;
const K_SINGLE  = `${PREFIX}single`;
const K_OTHER   = `${PREFIX}other-user`;

const ALL_KEYS = [K_MULTI_A, K_MULTI_B, K_NOMATCH, K_FREE, K_SINGLE, K_OTHER];

function entry(overrides: Partial<TokenEntry> = {}): TokenEntry {
  return {
    limit: 50000, window: 18_000_000, used: 0,
    windowStart: Date.now(), paused: false, dynamic: true,
    mode: "inherit", provider: "inherit", user_id: UID_A,
    label: "swap-fixture", description: "",
    pinned_model: "", allowed_models: [], output_type: "anthropic",
    last_reset: 0,
    ...overrides,
  };
}

async function seed(key: string, allowed: string[], overrides: Partial<TokenEntry> = {}) {
  const e = entry({ allowed_models: allowed, ...overrides });
  await dbInsertToken(key, e);
  tokens[key] = e;
}

function swap(fields: Record<string, string>): Promise<Response | null> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return handleTokenAllowedModels(
    "/admin/token/swap-model",
    new Request("http://local/admin/token/swap-model", { method: "POST" }),
    form,
  );
}

async function row(key: string) {
  const r = await prisma.tokens.findUnique({ where: { key } });
  if (!r) throw new Error(`fixture row missing: ${key}`);
  return { allowed: r.allowed_models, pinned: r.pinned_model };
}

async function wipe() {
  await prisma.tokens.deleteMany({ where: { key: { startsWith: PREFIX } } });
  for (const k of Object.keys(tokens)) if (k.startsWith(PREFIX)) delete tokens[k];
}

beforeAll(wipe);

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await wipe();
  await seed(K_MULTI_A, ["haiku", "opus-5", "sonnet-4-6"]);
  await seed(K_MULTI_B, ["haiku", "opus-5", "sonnet-4-6"]);
  // pinned_model deliberately drifted: if the handler rewrites this untouched
  // token, write() would repair the mirror and the drift would disappear.
  await seed(K_NOMATCH, ["haiku", "sonnet-4-6"], { pinned_model: "DRIFT-SENTINEL" });
  await seed(K_FREE, []);
  await seed(K_SINGLE, ["opus-5"], { pinned_model: "opus-5" });
  await seed(K_OTHER, ["haiku", "opus-5"], { user_id: UID_B });
});

describe("POST /admin/token/swap-model — golden path", () => {
  test("replaces the model in place, keeps order, counts only changed tokens", async () => {
    const res = await swap({ from: "opus-5", to: "sonnet-5" });
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    const body = await res!.json();
    expect(body.ok).toBe(true);
    // changed: multi-a, multi-b, single, other-user (no user_id filter)
    expect(body.count).toBe(4);

    for (const k of [K_MULTI_A, K_MULTI_B]) {
      expect(tokens[k]!.allowed_models).toEqual(["haiku", "sonnet-5", "sonnet-4-6"]);
      expect((await row(k)).allowed).toEqual(["haiku", "sonnet-5", "sonnet-4-6"]);
    }
  });

  test("persists to DB, not just the in-memory map", async () => {
    await swap({ from: "opus-5", to: "sonnet-5" });
    const r = await row(K_MULTI_A);
    expect(r.allowed).toEqual(["haiku", "sonnet-5", "sonnet-4-6"]);
  });

  test("empty `to` removes the model without a replacement", async () => {
    const res = await swap({ from: "opus-5", to: "" });
    const body = await res!.json();
    expect(body.count).toBe(4);
    expect((await row(K_MULTI_A)).allowed).toEqual(["haiku", "sonnet-4-6"]);
    expect((await row(K_SINGLE)).allowed).toEqual([]);
  });
});

describe("POST /admin/token/swap-model — include_unrestricted", () => {
  test("unrestricted token is untouched when the flag is absent", async () => {
    const res = await swap({ from: "opus-5", to: "sonnet-5" });
    const body = await res!.json();
    expect(body.count).toBe(4);
    expect(tokens[K_FREE]!.allowed_models).toEqual([]);
    expect((await row(K_FREE)).allowed).toEqual([]);
  });

  test("flag '1' with a non-empty `to` pins the unrestricted token to [to]", async () => {
    const res = await swap({ from: "opus-5", to: "sonnet-5", include_unrestricted: "1" });
    const body = await res!.json();
    expect(body.count).toBe(5);
    expect(tokens[K_FREE]!.allowed_models).toEqual(["sonnet-5"]);
    const r = await row(K_FREE);
    expect(r.allowed).toEqual(["sonnet-5"]);
    expect(r.pinned).toBe("sonnet-5");
  });

  test("flag 'true' is accepted too", async () => {
    const res = await swap({ from: "opus-5", to: "sonnet-5", include_unrestricted: "true" });
    expect((await res!.json()).count).toBe(5);
    expect((await row(K_FREE)).allowed).toEqual(["sonnet-5"]);
  });

  test("flag active but `to` empty leaves the unrestricted token alone", async () => {
    const res = await swap({ from: "opus-5", to: "", include_unrestricted: "1" });
    const body = await res!.json();
    expect(body.count).toBe(4);
    expect((await row(K_FREE)).allowed).toEqual([]);
  });
});

describe("POST /admin/token/swap-model — empty `from` (unrestricted only)", () => {
  test("sets only unrestricted tokens to [to], restricted ones untouched", async () => {
    const res = await swap({ from: "", to: "sonnet-5", include_unrestricted: "1" });
    expect(res!.status).toBe(200);
    expect((await res!.json()).count).toBe(1);
    const r = await row(K_FREE);
    expect(r.allowed).toEqual(["sonnet-5"]);
    expect(r.pinned).toBe("sonnet-5");
    expect((await row(K_MULTI_A)).allowed).toEqual(["haiku", "opus-5", "sonnet-4-6"]);
    expect((await row(K_SINGLE)).allowed).toEqual(["opus-5"]);
    expect((await row(K_NOMATCH)).pinned).toBe("DRIFT-SENTINEL");
  });

  test("without include_unrestricted → 400", async () => {
    const res = await swap({ from: "", to: "sonnet-5" });
    expect(res!.status).toBe(400);
    expect((await row(K_FREE)).allowed).toEqual([]);
  });
});

describe("POST /admin/token/swap-model — count accuracy", () => {
  test("token without `from` is neither counted nor rewritten", async () => {
    const res = await swap({ from: "opus-5", to: "sonnet-5" });
    expect((await res!.json()).count).toBe(4);
    const r = await row(K_NOMATCH);
    expect(r.allowed).toEqual(["haiku", "sonnet-4-6"]);
    expect(r.pinned).toBe("DRIFT-SENTINEL");
    expect(tokens[K_NOMATCH]!.pinned_model).toBe("DRIFT-SENTINEL");
  });

  test("`from` present in no token at all → count 0", async () => {
    const res = await swap({ from: "model-that-nobody-has", to: "sonnet-5" });
    expect((await res!.json()).count).toBe(0);
    expect((await row(K_MULTI_A)).allowed).toEqual(["haiku", "opus-5", "sonnet-4-6"]);
  });

  test("`to` already present collapses to a removal, counted once", async () => {
    const res = await swap({ from: "opus-5", to: "haiku" });
    expect((await res!.json()).count).toBe(4);
    expect((await row(K_MULTI_A)).allowed).toEqual(["haiku", "sonnet-4-6"]);
  });
});

describe("POST /admin/token/swap-model — failure mode", () => {
  test("empty `from` → 400, nothing changes", async () => {
    const res = await swap({ from: "", to: "sonnet-5" });
    expect(res).not.toBeNull();
    expect(res!.status).toBe(400);
    for (const k of ALL_KEYS) {
      expect((await row(k)).allowed).toEqual(tokens[k]!.allowed_models);
    }
    expect((await row(K_MULTI_A)).allowed).toEqual(["haiku", "opus-5", "sonnet-4-6"]);
    expect((await row(K_SINGLE)).allowed).toEqual(["opus-5"]);
  });

  test("whitespace-only `from` → 400", async () => {
    const res = await swap({ from: "   ", to: "sonnet-5" });
    expect(res!.status).toBe(400);
    expect((await row(K_MULTI_A)).allowed).toEqual(["haiku", "opus-5", "sonnet-4-6"]);
  });

  test("empty `from` with include_unrestricted but empty `to` → 400", async () => {
    const res = await swap({ from: "", to: "", include_unrestricted: "1" });
    expect(res!.status).toBe(400);
    expect((await row(K_FREE)).allowed).toEqual([]);
  });

  test("`from` === `to` → 400, nothing changes", async () => {
    const res = await swap({ from: "opus-5", to: "opus-5", include_unrestricted: "1" });
    expect(res!.status).toBe(400);
    expect(await res!.text()).toBe("'from' and 'to' are the same model\n");
    expect((await row(K_MULTI_A)).allowed).toEqual(["haiku", "opus-5", "sonnet-4-6"]);
    expect((await row(K_SINGLE)).allowed).toEqual(["opus-5"]);
    expect((await row(K_FREE)).allowed).toEqual([]);
  });

  test("non-POST method is not handled here", async () => {
    const res = await handleTokenAllowedModels(
      "/admin/token/swap-model",
      new Request("http://local/admin/token/swap-model", { method: "GET" }),
      null,
    );
    expect(res).toBeNull();
  });
});

describe("POST /admin/token/swap-model — user_id filter", () => {
  test("only tokens of the given user are touched", async () => {
    const res = await swap({ from: "opus-5", to: "sonnet-5", user_id: UID_B });
    expect((await res!.json()).count).toBe(1);
    expect((await row(K_OTHER)).allowed).toEqual(["haiku", "sonnet-5"]);
    expect((await row(K_MULTI_A)).allowed).toEqual(["haiku", "opus-5", "sonnet-4-6"]);
    expect((await row(K_SINGLE)).allowed).toEqual(["opus-5"]);
  });

  test("user filter also gates include_unrestricted", async () => {
    const res = await swap({
      from: "opus-5", to: "sonnet-5", user_id: UID_B, include_unrestricted: "1",
    });
    expect((await res!.json()).count).toBe(1);
    expect((await row(K_FREE)).allowed).toEqual([]);
  });

  test("unknown user_id → count 0", async () => {
    const res = await swap({ from: "opus-5", to: "sonnet-5", user_id: "test-user-swap-ghost" });
    expect((await res!.json()).count).toBe(0);
    expect((await row(K_MULTI_A)).allowed).toEqual(["haiku", "opus-5", "sonnet-4-6"]);
  });
});

describe("POST /admin/token/swap-model — pinned_model mirror", () => {
  test("swap leaving exactly one model updates the mirror", async () => {
    await swap({ from: "opus-5", to: "sonnet-5" });
    const r = await row(K_SINGLE);
    expect(r.allowed).toEqual(["sonnet-5"]);
    expect(r.pinned).toBe("sonnet-5");
    expect(tokens[K_SINGLE]!.pinned_model).toBe("sonnet-5");
  });

  test("swap leaving two or more models clears the mirror", async () => {
    await swap({ from: "opus-5", to: "sonnet-5" });
    const r = await row(K_MULTI_A);
    expect(r.allowed).toEqual(["haiku", "sonnet-5", "sonnet-4-6"]);
    expect(r.pinned).toBe("");
    expect(tokens[K_MULTI_A]!.pinned_model).toBe("");
  });

  test("removal down to one model also updates the mirror", async () => {
    await swap({ from: "opus-5", to: "" });
    const r = await row(K_OTHER);
    expect(r.allowed).toEqual(["haiku"]);
    expect(r.pinned).toBe("haiku");
  });

  test("removal down to zero models clears the mirror", async () => {
    await swap({ from: "opus-5", to: "" });
    const r = await row(K_SINGLE);
    expect(r.allowed).toEqual([]);
    expect(r.pinned).toBe("");
  });
});
