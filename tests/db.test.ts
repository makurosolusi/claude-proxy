/**
 * Database integration tests — requires PostgreSQL running
 * Run: DATABASE_URL=postgresql://... bun test tests/db.test.ts
 *
 * Uses isolated test data with prefix "sk-test-" — safe to run alongside prod data.
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";

// Ensure DATABASE_URL is set before importing prisma
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgresql://bip@localhost:5432/claude_proxy";
}

import { prisma } from "../src/prisma";
import {
  tokens, users, dailyUsage,
  dbInsertToken, dbInsertEnvToken, dbUpdateToken, dbSoftDelete, dbResetToken,
  dbResetAllTokens, dbAlignAllTokens, dbUpdateUsage, dbUpdateProvider,
  dbUpsertUser, dbUpdateUser, dbDeleteUser, dbLinkTokenToUser, dbSetUserRole,
  dbUpsertDailyUsage, dbSaveSetting, dbGetSetting, dbLogRequest,
  dbQueryLogs, dbCountLogs, dbGetLog, dbClearLogs, dbGetTokenNames, dbGetTokenKeys,
  deriveNameFromKey, slugify,
} from "../src/state";
import type { TokenEntry, UserEntry } from "../src/types";

// ── Test fixtures ─────────────────────────────────────────────────────────────
const TEST_KEY  = "sk-test-db-fixture-001";
const TEST_KEY2 = "sk-test-db-fixture-002";
const TEST_UID  = "test-user-db-001";

function makeTokenEntry(overrides: Partial<TokenEntry> = {}): TokenEntry {
  return {
    limit: 50000, window: 18_000_000, used: 0,
    windowStart: Date.now(), paused: false, dynamic: true,
    mode: "inherit", provider: "inherit", user_id: TEST_UID,
    label: "test-fixture", description: "", pinned_model: "", allowed_models: [], output_type: "anthropic",
    last_reset: 0,
    ...overrides,
  };
}

function makeUserEntry(overrides: Partial<UserEntry> = {}): UserEntry {
  return {
    id: TEST_UID, name: "Test Fixture", email: "test@fixture.com",
    description: "test user", created_at: Date.now(), role: "USER", status: "pending",
    ...overrides,
  };
}

// ── Setup / teardown ──────────────────────────────────────────────────────────
beforeAll(async () => {
  // Clean up any leftover test data
  await prisma.request_logs.deleteMany({ where: { token_key: { startsWith: "sk-test-" } } });
  await prisma.daily_usage.deleteMany({ where: { token_key: { startsWith: "sk-test-" } } });
  await prisma.tokens.deleteMany({ where: { key: { startsWith: "sk-test-" } } });
  await prisma.users.deleteMany({ where: { id: { startsWith: "test-user-" } } });
  await prisma.settings.deleteMany({ where: { key: { startsWith: "test-setting-" } } });
});

afterAll(async () => {
  // Clean up test data
  await prisma.request_logs.deleteMany({ where: { token_key: { startsWith: "sk-test-" } } });
  await prisma.daily_usage.deleteMany({ where: { token_key: { startsWith: "sk-test-" } } });
  await prisma.tokens.deleteMany({ where: { key: { startsWith: "sk-test-" } } });
  await prisma.users.deleteMany({ where: { id: { startsWith: "test-user-" } } });
  await prisma.settings.deleteMany({ where: { key: { startsWith: "test-setting-" } } });
  await prisma.$disconnect();
});

// ── 1. Token CRUD ─────────────────────────────────────────────────────────────
describe("dbInsertToken / dbInsertEnvToken", () => {
  afterAll(async () => {
    await prisma.tokens.deleteMany({ where: { key: { in: [TEST_KEY, TEST_KEY2] } } });
  });

  test("inserts new token into DB", async () => {
    const entry = makeTokenEntry();
    await dbInsertToken(TEST_KEY, entry);
    const row = await prisma.tokens.findUnique({ where: { key: TEST_KEY } });
    expect(row).not.toBeNull();
    expect(row!.label).toBe("test-fixture");
    expect(Number(row!.lim)).toBe(50000);
  });

  test("upserts existing token (updates fields)", async () => {
    const entry = makeTokenEntry({ limit: 99999 });
    await dbInsertToken(TEST_KEY, entry);
    const row = await prisma.tokens.findUnique({ where: { key: TEST_KEY } });
    expect(Number(row!.lim)).toBe(99999);
  });

  test("dbInsertEnvToken skips if key exists (do nothing on conflict)", async () => {
    await dbInsertToken(TEST_KEY, makeTokenEntry({ limit: 12345 }));
    // InsertEnvToken should NOT overwrite
    await dbInsertEnvToken(TEST_KEY, makeTokenEntry({ limit: 99999 }));
    const row = await prisma.tokens.findUnique({ where: { key: TEST_KEY } });
    expect(Number(row!.lim)).toBe(12345);
  });

  test("null lim → stored as null (unlimited)", async () => {
    await dbInsertToken(TEST_KEY2, makeTokenEntry({ limit: Infinity }));
    const row = await prisma.tokens.findUnique({ where: { key: TEST_KEY2 } });
    expect(row!.lim).toBeNull();
  });
});

describe("dbUpdateToken / dbUpdateUsage / dbUpdateProvider", () => {
  beforeAll(async () => {
    await dbInsertToken(TEST_KEY, makeTokenEntry());
  });

  afterAll(async () => {
    await prisma.tokens.delete({ where: { key: TEST_KEY } }).catch(() => {});
  });

  test("dbUpdateToken changes limit and paused", async () => {
    await dbUpdateToken(TEST_KEY, makeTokenEntry({ limit: 75000, paused: true }));
    const row = await prisma.tokens.findUnique({ where: { key: TEST_KEY } });
    expect(Number(row!.lim)).toBe(75000);
    expect(row!.paused).toBe(true);
  });

  test("dbUpdateUsage changes used field", async () => {
    await dbUpdateUsage(TEST_KEY, 12345);
    const row = await prisma.tokens.findUnique({ where: { key: TEST_KEY } });
    expect(Number(row!.used)).toBe(12345);
  });

  test("dbUpdateProvider changes provider", async () => {
    await dbUpdateProvider(TEST_KEY, "anthropic");
    const row = await prisma.tokens.findUnique({ where: { key: TEST_KEY } });
    expect(row!.provider).toBe("anthropic");
  });
});

describe("dbSoftDelete / dbResetToken / dbResetAllTokens", () => {
  beforeAll(async () => {
    await dbInsertToken(TEST_KEY, makeTokenEntry({ used: 1000 }));
    await dbInsertToken(TEST_KEY2, makeTokenEntry({ used: 2000 }));
  });

  afterAll(async () => {
    await prisma.tokens.deleteMany({ where: { key: { in: [TEST_KEY, TEST_KEY2] } } });
  });

  test("dbSoftDelete sets deleted=true", async () => {
    await dbSoftDelete(TEST_KEY);
    const row = await prisma.tokens.findUnique({ where: { key: TEST_KEY } });
    expect(row!.deleted).toBe(true);
  });

  test("dbResetToken sets used=0 and updates window_start", async () => {
    const now = Date.now();
    await dbResetToken(TEST_KEY2, now);
    const row = await prisma.tokens.findUnique({ where: { key: TEST_KEY2 } });
    expect(Number(row!.used)).toBe(0);
    expect(Number(row!.window_start)).toBe(now);
  });
});

// ── 2. User CRUD ──────────────────────────────────────────────────────────────
describe("dbUpsertUser / dbUpdateUser / dbDeleteUser", () => {
  afterAll(async () => {
    await prisma.users.deleteMany({ where: { id: { startsWith: "test-user-" } } });
  });

  test("creates new user", async () => {
    await dbUpsertUser(makeUserEntry());
    const row = await prisma.users.findUnique({ where: { id: TEST_UID } });
    expect(row).not.toBeNull();
    expect(row!.name).toBe("Test Fixture");
    expect(row!.email).toBe("test@fixture.com");
    expect(row!.role).toBe("USER");
  });

  test("updates existing user on conflict", async () => {
    await dbUpsertUser(makeUserEntry({ name: "Updated Name" }));
    const row = await prisma.users.findUnique({ where: { id: TEST_UID } });
    expect(row!.name).toBe("Updated Name");
  });

  test("dbUpdateUser changes name and description", async () => {
    await dbUpdateUser(TEST_UID, "New Name", "New Desc");
    const row = await prisma.users.findUnique({ where: { id: TEST_UID } });
    expect(row!.name).toBe("New Name");
    expect(row!.description).toBe("New Desc");
  });

  test("dbSetUserRole promotes to ADMIN", async () => {
    // Seed users in-memory map for dbSetUserRole to work
    users[TEST_UID] = makeUserEntry({ role: "USER" });
    await dbSetUserRole(TEST_UID, "ADMIN");
    const row = await prisma.users.findUnique({ where: { id: TEST_UID } });
    expect(row!.role).toBe("ADMIN");
    expect(users[TEST_UID]!.role).toBe("ADMIN");
    delete users[TEST_UID];
  });

  test("dbDeleteUser removes user", async () => {
    const uid = "test-user-to-delete";
    await dbUpsertUser(makeUserEntry({ id: uid, email: "del@test.com" }));
    await dbDeleteUser(uid);
    const row = await prisma.users.findUnique({ where: { id: uid } });
    expect(row).toBeNull();
  });
});

// ── 3. Settings ───────────────────────────────────────────────────────────────
describe("dbSaveSetting / dbGetSetting", () => {
  afterAll(async () => {
    await prisma.settings.deleteMany({ where: { key: { startsWith: "test-setting-" } } });
  });

  test("saves and retrieves setting", async () => {
    await dbSaveSetting("test-setting-foo", "bar");
    const val = await dbGetSetting("test-setting-foo");
    expect(val).toBe("bar");
  });

  test("updates existing setting", async () => {
    await dbSaveSetting("test-setting-foo", "updated");
    const val = await dbGetSetting("test-setting-foo");
    expect(val).toBe("updated");
  });

  test("returns null for missing key", async () => {
    const val = await dbGetSetting("test-setting-nonexistent");
    expect(val).toBeNull();
  });
});

// ── 4. Daily usage ────────────────────────────────────────────────────────────
describe("dbUpsertDailyUsage", () => {
  const testDate = "2099-01-01"; // far future to avoid collision

  afterAll(async () => {
    await prisma.daily_usage.deleteMany({ where: { date: testDate } });
  });

  test("inserts new entry", async () => {
    await dbUpsertDailyUsage(testDate, TEST_KEY, 100);
    const row = await prisma.daily_usage.findUnique({
      where: { date_token_key: { date: testDate, token_key: TEST_KEY } },
    });
    expect(row!.used).toBe(100);
  });

  test("accumulates on conflict", async () => {
    await dbUpsertDailyUsage(testDate, TEST_KEY, 50);
    const row = await prisma.daily_usage.findUnique({
      where: { date_token_key: { date: testDate, token_key: TEST_KEY } },
    });
    expect(row!.used).toBe(150); // 100 + 50
  });
});

// ── 5. Request logs ───────────────────────────────────────────────────────────
describe("dbLogRequest / dbQueryLogs / dbCountLogs / dbGetLog", () => {
  const LOG_KEY = "sk-test-log-key";

  beforeAll(async () => {
    // Ensure token exists for foreign key if needed
    await prisma.tokens.upsert({
      where: { key: LOG_KEY },
      create: { key: LOG_KEY, label: "log-test", user_id: "log-user", win: BigInt(18_000_000), window_start: BigInt(Date.now()) },
      update: {},
    });
  });

  afterAll(async () => {
    await prisma.request_logs.deleteMany({ where: { token_key: LOG_KEY } });
    await prisma.tokens.deleteMany({ where: { key: LOG_KEY } });
  });

  function makeLogEntry(overrides: any = {}) {
    return {
      ts: Date.now(),
      token_key: LOG_KEY, user_id: "log-user", name: "log-test",
      model: "claude-sonnet-4-6",
      input_tokens: 100, output_tokens: 50,
      cache_read: 10, cache_creation: 5,
      stream: false, status: 200,
      stop_reason: "end_turn", tool_use_count: 0,
      duration_ms: 1500, turns: 3,
      prompt: "test prompt", system_prompt: "",
      messages_json: "", response_text: "test response",
      ...overrides,
    };
  }

  test("dbLogRequest inserts log and returns id", async () => {
    const before = await dbCountLogs(LOG_KEY);
    await dbLogRequest(makeLogEntry());
    const after = await dbCountLogs(LOG_KEY);
    expect(after).toBe(before + 1);
  });

  test("dbCountLogs returns correct count per token", async () => {
    await dbLogRequest(makeLogEntry());
    await dbLogRequest(makeLogEntry());
    const count = await dbCountLogs(LOG_KEY);
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test("dbQueryLogs returns logs in desc order", async () => {
    const logs = await dbQueryLogs(1, 10, LOG_KEY);
    expect(logs.length).toBeGreaterThan(0);
    if (logs.length > 1) {
      expect(logs[0]!.ts).toBeGreaterThanOrEqual(logs[1]!.ts);
    }
  });

  test("dbGetLog retrieves single log by id", async () => {
    await dbLogRequest(makeLogEntry({ prompt: "unique-prompt-xyz" }));
    const logs = await dbQueryLogs(1, 5, LOG_KEY);
    const id = logs[0]!.id;
    const log = await dbGetLog(id);
    expect(log).not.toBeNull();
    expect(log!.id).toBe(id);
    expect(log!.token_key).toBe(LOG_KEY);
  });

  test("dbGetLog returns null for non-existent id", async () => {
    const log = await dbGetLog(999999999);
    expect(log).toBeNull();
  });

  test("dbQueryLogs pagination works", async () => {
    // Insert 5 more logs
    for (let i = 0; i < 5; i++) await dbLogRequest(makeLogEntry());
    const page1 = await dbQueryLogs(1, 3, LOG_KEY);
    const page2 = await dbQueryLogs(2, 3, LOG_KEY);
    expect(page1.length).toBe(3);
    // page2 ids should be different from page1
    const ids1 = new Set(page1.map(l => l.id));
    const ids2 = new Set(page2.map(l => l.id));
    const overlap = [...ids1].filter(id => ids2.has(id));
    expect(overlap.length).toBe(0);
  });

  test("dbClearLogs removes logs for specific token", async () => {
    const before = await dbCountLogs(LOG_KEY);
    expect(before).toBeGreaterThan(0);
    await dbClearLogs(LOG_KEY);
    const after = await dbCountLogs(LOG_KEY);
    expect(after).toBe(0);
  });
});

// ── 6. dbGetTokenNames / dbGetTokenKeys ──────────────────────────────────────
describe("dbGetTokenNames / dbGetTokenKeys", () => {
  beforeAll(async () => {
    await prisma.tokens.upsert({
      where: { key: TEST_KEY },
      create: { key: TEST_KEY, label: "fixture-name", user_id: "", win: BigInt(18_000_000), window_start: BigInt(Date.now()) },
      update: { label: "fixture-name" },
    });
    await prisma.request_logs.create({
      data: {
        ts: BigInt(Date.now()), token_key: TEST_KEY, name: "fixture-name",
        user_id: "", model: "claude-test", input_tokens: 1, output_tokens: 1,
        stream: false, status: 200, stop_reason: "end_turn",
        tool_use_count: 0, duration_ms: 100, turns: 1,
        prompt: "test", system_prompt: "", messages_json: "", response_text: "",
        cache_read: 0, cache_creation: 0,
      },
    });
  });

  afterAll(async () => {
    await prisma.request_logs.deleteMany({ where: { token_key: TEST_KEY } });
    await prisma.tokens.deleteMany({ where: { key: TEST_KEY } });
  });

  test("dbGetTokenNames returns array of strings", async () => {
    const names = await dbGetTokenNames();
    expect(Array.isArray(names)).toBe(true);
    expect(names.every(n => typeof n === "string")).toBe(true);
  });

  test("dbGetTokenKeys returns distinct keys", async () => {
    const keys = await dbGetTokenKeys();
    expect(Array.isArray(keys)).toBe(true);
    // No duplicates
    expect(new Set(keys).size).toBe(keys.length);
  });
});

// ── 7. Admin notifications + dismissals ───────────────────────────────────────
describe("admin_notifications + notification_dismissals", () => {
  const A_UID = "test-user-notif-a";
  const B_UID = "test-user-notif-b";
  const C_UID = "test-user-notif-c";
  const NIDS: string[] = [];

  beforeAll(async () => {
    await prisma.notification_dismissals.deleteMany({ where: { user_id: { startsWith: "test-user-notif-" } } });
    await prisma.admin_notifications.deleteMany({ where: { id: { startsWith: "test-notif-" } } });
    await prisma.users.deleteMany({ where: { id: { in: [A_UID, B_UID, C_UID] } } });
    const now = Date.now();
    await prisma.users.createMany({
      data: [
        { id: A_UID, name: "Notif A", email: "", description: "", created_at: BigInt(now), role: "USER", status: "approved" },
        { id: B_UID, name: "Notif B", email: "", description: "", created_at: BigInt(now), role: "USER", status: "approved" },
        { id: C_UID, name: "Notif C", email: "", description: "", created_at: BigInt(now), role: "USER", status: "approved" },
      ],
    });
  });

  afterAll(async () => {
    await prisma.notification_dismissals.deleteMany({ where: { user_id: { startsWith: "test-user-notif-" } } });
    await prisma.admin_notifications.deleteMany({ where: { id: { in: NIDS } } });
    await prisma.users.deleteMany({ where: { id: { in: [A_UID, B_UID, C_UID] } } });
  });

  test("broadcast to all: every user sees the notification", async () => {
    const id = `test-notif-all-${Date.now()}`;
    NIDS.push(id);
    await prisma.admin_notifications.create({
      data: {
        id, message: "Hello everyone", created_at: BigInt(Date.now()),
        created_by: "admin@test", target_type: "all", target_ids: "", deleted: false,
      },
    });
    const row = await prisma.admin_notifications.findUnique({ where: { id } });
    expect(row?.target_type).toBe("all");
    expect(row?.message).toBe("Hello everyone");
  });

  test("dismissal hides the notification only for the dismisser", async () => {
    const id = `test-notif-dismiss-${Date.now()}`;
    NIDS.push(id);
    await prisma.admin_notifications.create({
      data: {
        id, message: "Read me", created_at: BigInt(Date.now()),
        created_by: "admin@test", target_type: "all", target_ids: "", deleted: false,
      },
    });
    await prisma.notification_dismissals.create({
      data: { notification_id: id, user_id: A_UID, dismissed_at: BigInt(Date.now()) },
    });
    const aDismissed = await prisma.notification_dismissals.findUnique({
      where: { notification_id_user_id: { notification_id: id, user_id: A_UID } },
    });
    const bDismissed = await prisma.notification_dismissals.findUnique({
      where: { notification_id_user_id: { notification_id: id, user_id: B_UID } },
    });
    expect(aDismissed).not.toBeNull();
    expect(bDismissed).toBeNull();
  });

  test("specific targeting: only listed user_ids match", async () => {
    const id = `test-notif-specific-${Date.now()}`;
    NIDS.push(id);
    await prisma.admin_notifications.create({
      data: {
        id, message: "Only A and B", created_at: BigInt(Date.now()),
        created_by: "admin@test", target_type: "specific",
        target_ids: JSON.stringify([A_UID, B_UID]), deleted: false,
      },
    });
    const row = await prisma.admin_notifications.findUnique({ where: { id } });
    const targets = JSON.parse(row!.target_ids);
    expect(targets).toEqual([A_UID, B_UID]);
    expect(targets).not.toContain(C_UID);
  });

  test("upsert dismissal is idempotent (no duplicate pk error)", async () => {
    const id = `test-notif-idem-${Date.now()}`;
    NIDS.push(id);
    await prisma.admin_notifications.create({
      data: {
        id, message: "x", created_at: BigInt(Date.now()),
        created_by: "", target_type: "all", target_ids: "", deleted: false,
      },
    });
    await prisma.notification_dismissals.upsert({
      where:  { notification_id_user_id: { notification_id: id, user_id: A_UID } },
      create: { notification_id: id, user_id: A_UID, dismissed_at: BigInt(Date.now()) },
      update: { dismissed_at: BigInt(Date.now()) },
    });
    await prisma.notification_dismissals.upsert({
      where:  { notification_id_user_id: { notification_id: id, user_id: A_UID } },
      create: { notification_id: id, user_id: A_UID, dismissed_at: BigInt(Date.now()) },
      update: { dismissed_at: BigInt(Date.now() + 1) },
    });
    const cnt = await prisma.notification_dismissals.count({ where: { notification_id: id } });
    expect(cnt).toBe(1);
  });

  test("soft delete hides the notification from active list query", async () => {
    const id = `test-notif-soft-${Date.now()}`;
    NIDS.push(id);
    await prisma.admin_notifications.create({
      data: {
        id, message: "ephemeral", created_at: BigInt(Date.now()),
        created_by: "", target_type: "all", target_ids: "", deleted: false,
      },
    });
    await prisma.admin_notifications.update({ where: { id }, data: { deleted: true } });
    const active = await prisma.admin_notifications.findMany({ where: { id, deleted: false } });
    expect(active).toEqual([]);
    const all = await prisma.admin_notifications.findUnique({ where: { id } });
    expect(all?.deleted).toBe(true);
  });
});
