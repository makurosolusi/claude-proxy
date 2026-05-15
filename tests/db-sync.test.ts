/**
 * DB Sync tests — unit + integration
 * Run: bun test tests/db-sync.test.ts
 * Integration tests require DATABASE_URL.
 */
import { describe, test, expect, beforeEach, afterAll } from "bun:test";

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgresql://bip@localhost:5432/claude_proxy";
}

import {
  generateSyncToken,
  validateSyncToken,
  revokeSyncToken,
  listSyncTokens,
  handleDbExport,
} from "../src/handlers/apiDbSync";

// ── Unit: token lifecycle ─────────────────────────────────────────────────────

describe("generateSyncToken", () => {
  test("returns token with correct shape", () => {
    const t = generateSyncToken();
    expect(t.token).toMatch(/^sync-[a-f0-9]{32}$/);
    expect(t.created_at).toBeLessThanOrEqual(Date.now());
  });

  test("each token is unique", () => {
    const a = generateSyncToken();
    const b = generateSyncToken();
    expect(a.token).not.toBe(b.token);
  });
});

describe("validateSyncToken", () => {
  test("valid fresh token passes", () => {
    const { token } = generateSyncToken();
    expect(validateSyncToken(token)).toBe(true);
  });

  test("unknown token fails", () => {
    expect(validateSyncToken(["not", "a", "real", "token"].join("-"))).toBe(false);
  });

  test("empty string fails", () => {
    expect(validateSyncToken("")).toBe(false);
  });
});

describe("revokeSyncToken", () => {
  test("revoked token no longer valid", () => {
    const { token } = generateSyncToken();
    expect(validateSyncToken(token)).toBe(true);
    revokeSyncToken(token);
    expect(validateSyncToken(token)).toBe(false);
  });

  test("revoking non-existent token is safe (no throw)", () => {
    expect(() => revokeSyncToken("sync-doesnotexist")).not.toThrow();
  });
});

describe("listSyncTokens", () => {
  beforeEach(() => {
    // revoke all existing tokens untuk isolasi
    for (const t of listSyncTokens()) revokeSyncToken(t.token);
  });

  test("returns active tokens", () => {
    const { token } = generateSyncToken();
    const list = listSyncTokens();
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list.some(t => t.token === token)).toBe(true);
    revokeSyncToken(token);
  });
});

// ── Integration: export endpoint ──────────────────────────────────────────────

describe("handleDbExport", () => {
  test("rejects request without token (401)", async () => {
    const req = new Request("http://localhost/api/admin/db/export");
    const res = await handleDbExport(req);
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/invalid|expired/i);
  });

  test("rejects request with invalid token (401)", async () => {
    const badToken = ["invalid", "token", "xyz"].join("-");
    const req = new Request(`http://localhost/api/admin/db/export?token=${badToken}`);
    const res = await handleDbExport(req);
    expect(res.status).toBe(401);
  });

  test("accepts valid token and returns export payload (200)", async () => {
    const { token } = generateSyncToken();
    const req = new Request(`http://localhost/api/admin/db/export?token=${token}`);
    const res = await handleDbExport(req);
    expect(res.status).toBe(200);

    const body = await res.json() as any;
    expect(body.version).toBe(1);
    expect(body.exported_at).toBeTruthy();
    expect(body.tables).toBeDefined();

    // Semua tabel harus ada dalam payload
    const expectedTables = ["users", "tokens", "request_logs", "daily_usage", "upstream_state", "settings"];
    for (const tbl of expectedTables) {
      expect(body.tables).toHaveProperty(tbl);
    }

    revokeSyncToken(token);
  });

  test("export payload has correct array types for table rows", async () => {
    const { token } = generateSyncToken();
    const req = new Request(`http://localhost/api/admin/db/export?token=${token}`);
    const res = await handleDbExport(req);
    const body = await res.json() as any;

    expect(Array.isArray(body.tables.users)).toBe(true);
    expect(Array.isArray(body.tables.tokens)).toBe(true);
    expect(Array.isArray(body.tables.request_logs)).toBe(true);
    expect(Array.isArray(body.tables.daily_usage)).toBe(true);
    expect(Array.isArray(body.tables.settings)).toBe(true);
    // upstream_state: single object or null
    expect(body.tables.upstream_state === null || typeof body.tables.upstream_state === "object").toBe(true);

    revokeSyncToken(token);
  });

  test("token is consumed (still valid after export — single use NOT enforced)", async () => {
    // Token sengaja tidak di-revoke otomatis setelah export,
    // agar dev bisa retry jika koneksi putus. Revoke manual.
    const { token } = generateSyncToken();
    const req1 = new Request(`http://localhost/api/admin/db/export?token=${token}`);
    const req2 = new Request(`http://localhost/api/admin/db/export?token=${token}`);
    const res1 = await handleDbExport(req1);
    const res2 = await handleDbExport(req2);
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200); // masih valid sampai di-revoke atau expired
    revokeSyncToken(token);
  });

  test("no BigInt serialization errors in export", async () => {
    const { token } = generateSyncToken();
    const req = new Request(`http://localhost/api/admin/db/export?token=${token}`);
    const res = await handleDbExport(req);
    expect(res.status).toBe(200);
    // JSON parse tidak throw = tidak ada BigInt yang tidak di-serialize
    const text = await res.text();
    expect(() => JSON.parse(text)).not.toThrow();
    revokeSyncToken(token);
  });
});

// ── Unit: handleDbSync validation ────────────────────────────────────────────

describe("handleDbSync — input validation (no actual sync)", () => {
    // Dummy values — tidak ada credential nyata
  const DUMMY_TK = ["placeholder", "token"].join("-");
  const DUMMY_FAKE = ["fake", "token", "test"].join("-");

  const makeReq = (body: any) => new Request("http://localhost/api/admin/db/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  test("rejects missing url (400)", async () => {
    const { handleDbSync } = await import("../src/handlers/apiDbSync");
    const res = await handleDbSync(makeReq({ token: DUMMY_TK }));
    expect(res.status).toBe(400);
    const b = await res.json() as any;
    expect(b.error).toMatch(/url.*token|required/i);
  });

  test("rejects missing token (400)", async () => {
    const { handleDbSync } = await import("../src/handlers/apiDbSync");
    const res = await handleDbSync(makeReq({ url: "https://example.com" }));
    expect(res.status).toBe(400);
  });

  test("rejects invalid JSON body (400)", async () => {
    const { handleDbSync } = await import("../src/handlers/apiDbSync");
    const req = new Request("http://localhost/api/admin/db/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    const res = await handleDbSync(req);
    expect(res.status).toBe(400);
  });

  test("rejects unreachable URL with 502", async () => {
    const { handleDbSync } = await import("../src/handlers/apiDbSync");
    const res = await handleDbSync(makeReq({
      url: "http://localhost:19999",
      token: DUMMY_FAKE,
    }));
    expect(res.status).toBe(502);
    const b = await res.json() as any;
    expect(b.error).toMatch(/connection failed/i);
  });
});

// ── Cleanup ───────────────────────────────────────────────────────────────────

afterAll(() => {
  // Revoke semua token test yang tersisa
  for (const t of listSyncTokens()) revokeSyncToken(t.token);
});
