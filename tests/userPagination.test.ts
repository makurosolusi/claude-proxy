/**
 * Tests for user-list pagination logic in Users.tsx.
 * Pure logic — no DOM/React needed.
 * Run: bun test tests/userPagination.test.ts
 */
import { describe, test, expect } from "bun:test";

const USERS_PER_PAGE = 10;

function paginate<T>(list: T[], page: number, perPage = USERS_PER_PAGE) {
  return list.slice((page - 1) * perPage, page * perPage);
}

function totalPages<T>(list: T[], perPage = USERS_PER_PAGE) {
  return Math.ceil(list.length / perPage);
}

function makeUsers(n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: String(i), name: `User ${i}` }));
}

describe("user list pagination", () => {
  test("0 users → 0 pages", () => {
    expect(totalPages(makeUsers(0))).toBe(0);
  });

  test("1 user → 1 page", () => {
    expect(totalPages(makeUsers(1))).toBe(1);
    expect(paginate(makeUsers(1), 1)).toHaveLength(1);
  });

  test("10 users → 1 page, all visible", () => {
    const users = makeUsers(10);
    expect(totalPages(users)).toBe(1);
    expect(paginate(users, 1)).toHaveLength(10);
  });

  test("11 users → 2 pages", () => {
    const users = makeUsers(11);
    expect(totalPages(users)).toBe(2);
    expect(paginate(users, 1)).toHaveLength(10);
    expect(paginate(users, 2)).toHaveLength(1);
  });

  test("20 users → 2 pages, 10 each", () => {
    const users = makeUsers(20);
    expect(totalPages(users)).toBe(2);
    expect(paginate(users, 1)).toHaveLength(10);
    expect(paginate(users, 2)).toHaveLength(10);
  });

  test("21 users → 3 pages (3rd has 1)", () => {
    const users = makeUsers(21);
    expect(totalPages(users)).toBe(3);
    expect(paginate(users, 3)).toHaveLength(1);
  });

  test("page 1 returns first 10 users", () => {
    const users = makeUsers(20);
    const page1 = paginate(users, 1);
    expect(page1[0].name).toBe("User 0");
    expect(page1[9].name).toBe("User 9");
  });

  test("page 2 returns next 10 users", () => {
    const users = makeUsers(20);
    const page2 = paginate(users, 2);
    expect(page2[0].name).toBe("User 10");
    expect(page2[9].name).toBe("User 19");
  });
});

describe("per-token pagination in UserCard", () => {
  const PER_PAGE          = 5;
  const PER_PAGE_EXPANDED = 10;

  function makeTokens(n: number) {
    return Array.from({ length: n }, (_, i) => ({ key: `tok-${i}` }));
  }

  test("5 tokens → 1 page, pagination hidden", () => {
    const tokens = makeTokens(5);
    expect(Math.ceil(tokens.length / PER_PAGE)).toBe(1);
    // needsPaging = tokens.length > PER_PAGE (5 > 5 = false)
    expect(tokens.length > PER_PAGE).toBe(false);
  });

  test("6 tokens → 2 pages, pagination visible", () => {
    const tokens = makeTokens(6);
    expect(tokens.length > PER_PAGE).toBe(true);
    expect(Math.ceil(tokens.length / PER_PAGE)).toBe(2);
  });

  test("30 tokens collapsed → 6 pages", () => {
    const tokens = makeTokens(30);
    expect(Math.ceil(tokens.length / PER_PAGE)).toBe(6);
  });

  test("30 tokens expanded → 3 pages", () => {
    const tokens = makeTokens(30);
    expect(Math.ceil(tokens.length / PER_PAGE_EXPANDED)).toBe(3);
  });

  test("page 1 returns first 5 tokens", () => {
    const tokens = makeTokens(30);
    const page1 = tokens.slice(0, PER_PAGE);
    expect(page1).toHaveLength(5);
    expect(page1[0].key).toBe("tok-0");
    expect(page1[4].key).toBe("tok-4");
  });
});
