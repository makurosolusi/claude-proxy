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

    // Export is NDJSON (v2): one JSON object per line — meta, then row/table_end.
    const lines = (await res.text()).trim().split("\n").filter(Boolean).map(l => JSON.parse(l));
    const meta = lines[0];
    expect(meta.type).toBe("meta");
    expect(meta.version).toBe(2);
    expect(meta.exported_at).toBeTruthy();

    // Every table must be accounted for by a table_end marker.
    const ended = new Set(lines.filter(l => l.type === "table_end").map(l => l.table));
    for (const tbl of ["users", "tokens", "request_logs", "daily_usage", "upstream_state", "settings"]) {
      expect(ended).toContain(tbl);
    }

    revokeSyncToken(token);
  });

  test("export rows carry table name and data payload", async () => {
    const { token } = generateSyncToken();
    const req = new Request(`http://localhost/api/admin/db/export?token=${token}`);
    const res = await handleDbExport(req);
    const lines = (await res.text()).trim().split("\n").filter(Boolean).map(l => JSON.parse(l));

    const rows = lines.filter(l => l.type === "row");
    for (const r of rows) {
      expect(typeof r.table).toBe("string");
      expect(r.data).toBeDefined();
    }
    // table_end counts must match the rows actually emitted for that table.
    for (const end of lines.filter(l => l.type === "table_end")) {
      expect(rows.filter(r => r.table === end.table).length).toBe(end.count);
    }

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
    // Every NDJSON line must parse = no unserialized BigInt slipped through.
    const text = await res.text();
    for (const line of text.trim().split("\n").filter(Boolean)) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
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

  test("unreachable URL emits SSE error event (network)", async () => {
    const { handleDbSync } = await import("../src/handlers/apiDbSync");
    const res = await handleDbSync(makeReq({
      url: "http://localhost:19999",
      token: DUMMY_FAKE,
    }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const text = await res.text();
    expect(text).toMatch(/event: error/);
    expect(text).toMatch(/"phase":"export_fetch"/);
    expect(text.toLowerCase()).toMatch(/network error|fetch/);
  });
});

// ── Cleanup ───────────────────────────────────────────────────────────────────

afterAll(() => {
  // Revoke semua token test yang tersisa
  for (const t of listSyncTokens()) revokeSyncToken(t.token);
});
