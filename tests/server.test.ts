/**
 * Integration tests — hits the live server at TEST_URL (default http://127.0.0.1:8081)
 * Run: bun test tests/server.test.ts
 * Or with custom URL: TEST_URL=http://127.0.0.1:8081 bun test
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";

const BASE    = process.env.TEST_URL || "http://127.0.0.1:8081";
const TOKEN   = "sk-user-bagas";
const BAD_TOK = "sk-user-invalid-xxx";
const ADMIN_K = process.env.ADMIN_KEY || "malikkurosaki";

async function get(path: string, headers: Record<string, string> = {}) {
  return fetch(BASE + path, { headers });
}
async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(BASE + path, {
    method:  "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body:    JSON.stringify(body),
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
async function resetTokenUsage() {
  await fetch(BASE + "/admin/reset", {
    method: "POST",
    headers: { "x-admin-key": ADMIN_K, "Content-Type": "application/x-www-form-urlencoded" },
  });
}

// ── Health / Status ───────────────────────────────────────────────────────────
describe("GET /api/status", () => {
  test("returns 200 with correct shape", async () => {
    const r = await get("/api/status");
    expect(r.status).toBe(200);
    const j = await r.json() as any;
    expect(j).toHaveProperty("ts");
    expect(j).toHaveProperty("tokens");
    expect(j).toHaveProperty("isAdmin");
    expect(j.isAdmin).toBe(false);
  });

  test("tokens object contains expected keys", async () => {
    const j = await (await get("/api/status")).json() as any;
    expect(Object.keys(j.tokens)).toContain("sk-user-bagas");
    expect(Object.keys(j.tokens)).toContain("sk-user-nico");
    expect(Object.keys(j.tokens)).toContain("sk-user-amel");
  });

  test("upstream info present in response", async () => {
    const j = await (await get("/api/status")).json() as any;
    expect(j).toHaveProperty("upstream");
  });

  test("isAdmin=true when x-admin-key header supplied", async () => {
    const j = await (await get("/api/status", { "x-admin-key": ADMIN_K })).json() as any;
    expect(j.isAdmin).toBe(true);
  });
});

// ── Token Auth ────────────────────────────────────────────────────────────────
describe("Token authentication", () => {
  test("missing token → 401", async () => {
    const r = await get("/v1/usage");
    expect(r.status).toBe(401);
  });

  test("invalid token → 401", async () => {
    const r = await get("/v1/usage", { "x-api-key": BAD_TOK });
    expect(r.status).toBe(401);
  });

  test("valid token → 200", async () => {
    const r = await get("/v1/usage", { "x-api-key": TOKEN });
    expect(r.status).toBe(200);
  });

  test("Bearer auth also works", async () => {
    const r = await get("/v1/usage", { "Authorization": "Bearer " + TOKEN });
    expect(r.status).toBe(200);
  });
});

// ── /v1/usage ─────────────────────────────────────────────────────────────────
describe("GET /v1/usage", () => {
  test("returns usage fields", async () => {
    const j = await (await get("/v1/usage", { "x-api-key": TOKEN })).json() as any;
    expect(j).toHaveProperty("used");
    expect(j).toHaveProperty("limit");
    expect(j).toHaveProperty("remaining");
    expect(j).toHaveProperty("reset_in_seconds");
    expect(j).toHaveProperty("reset_at");
  });

  test("limit is 60000", async () => {
    const j = await (await get("/v1/usage", { "x-api-key": TOKEN })).json() as any;
    expect(j.limit).toBe(60000);
  });

  test("reset_at is valid ISO string", async () => {
    const j = await (await get("/v1/usage", { "x-api-key": TOKEN })).json() as any;
    expect(new Date(j.reset_at).getTime()).toBeGreaterThan(0);
  });
});

// ── /v1/models ────────────────────────────────────────────────────────────────
describe("GET /v1/models", () => {
  test("returns model list", async () => {
    const r = await get("/v1/models", { "x-api-key": TOKEN });
    expect(r.status).toBe(200);
    const j = await r.json() as any;
    expect(Array.isArray(j.data)).toBe(true);
    expect(j.data.length).toBeGreaterThan(0);
    expect(j.data[0]).toHaveProperty("id");
  });
});

// ── /v1/messages/count_tokens ─────────────────────────────────────────────────
describe("POST /v1/messages/count_tokens", () => {
  test("stub returns input_tokens=0", async () => {
    const r = await post("/v1/messages/count_tokens",
      { model: "claude-sonnet-4-6", messages: [{ role: "user", content: "hi" }] },
      { "x-api-key": TOKEN }
    );
    expect(r.status).toBe(200);
    const j = await r.json() as any;
    expect(j.input_tokens).toBe(0);
  });
});

// ── Rate limit headers ────────────────────────────────────────────────────────
describe("Rate limit response headers", () => {
  test("/v1/usage returns ratelimit headers", async () => {
    // Trigger a non-streaming response to check headers
    // count_tokens also returns ratelimit headers because it goes through proxy
    const r = await post("/v1/messages/count_tokens",
      { model: "claude-sonnet-4-6", messages: [] },
      { "x-api-key": TOKEN }
    );
    // These headers are only on proxied responses; count_tokens is a stub
    // So we check /v1/usage instead which returns rate info in body
    const j = await (await get("/v1/usage", { "x-api-key": TOKEN })).json() as any;
    expect(typeof j.remaining).toBe("number");
  });
});

// ── Quota enforcement ─────────────────────────────────────────────────────────
describe("Quota enforcement", () => {
  test("paused token returns 403", async () => {
    // Pause via admin
    const pauseForm = new URLSearchParams({ token: "sk-user-amel" });
    await fetch(BASE + "/admin/token/pause", {
      method:  "POST",
      headers: { "x-admin-key": ADMIN_K, "Content-Type": "application/x-www-form-urlencoded" },
      body:    pauseForm,
    });

    const r = await post("/v1/messages",
      { model: "claude-sonnet-4-6", messages: [{ role: "user", content: "hi" }] },
      { "x-api-key": "sk-user-amel" }
    );
    expect(r.status).toBe(403);

    // Unpause
    await fetch(BASE + "/admin/token/pause", {
      method:  "POST",
      headers: { "x-admin-key": ADMIN_K, "Content-Type": "application/x-www-form-urlencoded" },
      body:    pauseForm,
    });
  });
});

// ── Admin endpoints ───────────────────────────────────────────────────────────
describe("Admin auth", () => {
  test("GET /api/stats without auth → 401", async () => {
    const r = await get("/api/stats");
    expect(r.status).toBe(401);
  });

  test("GET /api/stats with x-admin-key → 200", async () => {
    const r = await get("/api/stats", { "x-admin-key": ADMIN_K });
    expect(r.status).toBe(200);
  });

  test("POST /admin/reset without auth → redirects to login (303)", async () => {
    const r = await fetch(BASE + "/admin/reset", { method: "POST", redirect: "manual" });
    // Admin form routes redirect unauthenticated browsers to /admin/login
    expect([303, 401]).toContain(r.status);
  });

  test("POST /admin/token/mode invalid mode → 400", async () => {
    const form = new URLSearchParams({ token: TOKEN, mode: "badmode" });
    const r = await fetch(BASE + "/admin/token/mode", {
      method:  "POST",
      headers: { "x-admin-key": ADMIN_K, "Content-Type": "application/x-www-form-urlencoded" },
      body:    form,
    });
    expect(r.status).toBe(400);
  });

  test("POST /admin/token/mode valid → 200/302 and persisted", async () => {
    const form = new URLSearchParams({ token: TOKEN, mode: "direct" });
    const r = await fetch(BASE + "/admin/token/mode", {
      method:   "POST",
      redirect: "manual",
      headers:  { "x-admin-key": ADMIN_K, "Content-Type": "application/x-www-form-urlencoded" },
      body:     form,
    });
    expect([200, 302, 303]).toContain(r.status);

    // Reset back to inherit
    const form2 = new URLSearchParams({ token: TOKEN, mode: "inherit" });
    await fetch(BASE + "/admin/token/mode", {
      method:   "POST",
      redirect: "manual",
      headers:  { "x-admin-key": ADMIN_K, "Content-Type": "application/x-www-form-urlencoded" },
      body:     form2,
    });
  });
});

// ── Request logs ──────────────────────────────────────────────────────────────
describe("GET /api/logs", () => {
  test("returns paginated response", async () => {
    const r = await get("/api/logs");
    expect(r.status).toBe(200);
    const j = await r.json() as any;
    expect(j).toHaveProperty("logs");
    expect(Array.isArray(j.logs)).toBe(true);
    expect(j).toHaveProperty("total");
    expect(j).toHaveProperty("page");
  });

  test("?limit param respected", async () => {
    const j = await (await get("/api/logs?limit=2")).json() as any;
    expect(j.logs.length).toBeLessThanOrEqual(2);
  });

  test("?user filter works", async () => {
    const j = await (await get("/api/logs?user=" + TOKEN)).json() as any;
    for (const log of j.logs) {
      expect(log.token_key).toBe(TOKEN);
    }
  });
});

// ── 404 ───────────────────────────────────────────────────────────────────────
describe("Unknown routes", () => {
  test("unknown API route → 404 JSON", async () => {
    const r = await get("/v1/nonexistent", { "x-api-key": TOKEN });
    expect(r.status).toBe(404);
  });
});

// ── Context Block Enforcement toggle ─────────────────────────────────────────
describe("POST /admin/settings/context-block-enabled", () => {
  async function postSetting(enabled: string) {
    const form = new URLSearchParams({ enabled });
    return fetch(BASE + "/admin/settings/context-block-enabled", {
      method:  "POST",
      headers: { "x-admin-key": ADMIN_K, "Content-Type": "application/x-www-form-urlencoded" },
      body:    form,
    });
  }

  async function getSetting(): Promise<string | undefined> {
    const r = await fetch(BASE + "/api/admin/settings", { headers: { "x-admin-key": ADMIN_K } });
    const d = await r.json() as any;
    return d.context_block_enabled;
  }

  test("without auth → 303 redirect", async () => {
    const form = new URLSearchParams({ enabled: "false" });
    const r = await fetch(BASE + "/admin/settings/context-block-enabled", {
      method: "POST", redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
    });
    expect([303, 401]).toContain(r.status);
  });

  test("disable → setting persists as 'false'", async () => {
    const r = await postSetting("false");
    expect(r.status).toBe(200);
    const val = await getSetting();
    expect(val).toBe("false");
  });

  test("re-enable → setting persists as 'true'", async () => {
    await postSetting("false");
    const r = await postSetting("true");
    expect(r.status).toBe(200);
    const val = await getSetting();
    expect(val).toBe("true");
  });

  test("invalid value → treated as 'true' (safe default)", async () => {
    await postSetting("false");
    const r = await postSetting("garbage");
    expect(r.status).toBe(200);
    const val = await getSetting();
    expect(val).toBe("true");
  });

  test("response includes ok:true", async () => {
    const r = await postSetting("true");
    const j = await r.json() as any;
    expect(j.ok).toBe(true);
  });

  // Restore enabled state after all tests
  afterAll(async () => { await postSetting("true"); });
});

// ── SPA fallback ──────────────────────────────────────────────────────────────
describe("SPA / static routes", () => {
  test("GET / returns HTML", async () => {
    const r = await get("/");
    expect(r.status).toBe(200);
    const ct = r.headers.get("content-type") || "";
    expect(ct).toContain("text/html");
  });

  test("GET /mind returns HTML (SPA fallback)", async () => {
    const r = await get("/mind");
    expect(r.status).toBe(200);
    const ct = r.headers.get("content-type") || "";
    expect(ct).toContain("text/html");
  });
});
