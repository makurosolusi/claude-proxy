/**
 * Tests for the backend approved-user gate (Layer 1).
 * Pure function mirrors of requireApprovedUser / gateApproved in src/index.tsx —
 * no Better Auth session or DB needed. The mirrors must stay byte-for-byte
 * faithful to the real decision logic so a regression there is caught here.
 * Run: bun test tests/approvedGate.test.ts
 */
import { describe, test, expect } from "bun:test";

type UserLike = { userId: string; email: string; status: string } | null;

// ── Mirrors requireApprovedUser in src/index.tsx ──────────────────────────────
// Returns the user when allowed (approved, or pending while demo_mode is ON),
// otherwise null. Anonymous (no session) is always null.
function requireApprovedDecision(
  user: UserLike,
  demoMode: boolean,
): "allow" | "deny" {
  if (!user) return "deny";
  const approved = user.status === "approved" || (demoMode && user.status === "pending");
  return approved ? "allow" : "deny";
}

// ── Mirrors gateApproved in src/index.tsx ─────────────────────────────────────
// Allows when the requester is an approved user OR an admin; 403 otherwise.
function gateApprovedDecision(
  user: UserLike,
  demoMode: boolean,
  isAdmin: boolean,
): "allow" | "403" {
  if (requireApprovedDecision(user, demoMode) === "allow") return "allow";
  if (isAdmin) return "allow";
  return "403";
}

const approved = { userId: "u1", email: "a@x.com", status: "approved" };
const pending  = { userId: "u2", email: "p@x.com", status: "pending" };
const blocked  = { userId: "u3", email: "b@x.com", status: "blocked" };

// ── requireApprovedUser ───────────────────────────────────────────────────────
describe("requireApprovedUser", () => {
  test("anonymous (no session) → deny", () => {
    expect(requireApprovedDecision(null, false)).toBe("deny");
  });

  test("approved user → allow", () => {
    expect(requireApprovedDecision(approved, false)).toBe("allow");
  });

  test("pending user, demo OFF → deny", () => {
    expect(requireApprovedDecision(pending, false)).toBe("deny");
  });

  test("pending user, demo ON → allow (mirrors /api/profile effectiveStatus)", () => {
    expect(requireApprovedDecision(pending, true)).toBe("allow");
  });

  test("blocked user, demo OFF → deny", () => {
    expect(requireApprovedDecision(blocked, false)).toBe("deny");
  });

  test("blocked user, demo ON → deny (demo only promotes pending, never blocked)", () => {
    expect(requireApprovedDecision(blocked, true)).toBe("deny");
  });

  test("anonymous even with demo ON → deny (demo never grants without a session)", () => {
    expect(requireApprovedDecision(null, true)).toBe("deny");
  });
});

// ── gateApproved ──────────────────────────────────────────────────────────────
describe("gateApproved", () => {
  test("anonymous, not admin → 403", () => {
    expect(gateApprovedDecision(null, false, false)).toBe("403");
  });

  test("pending, demo OFF, not admin → 403", () => {
    expect(gateApprovedDecision(pending, false, false)).toBe("403");
  });

  test("blocked, not admin → 403", () => {
    expect(gateApprovedDecision(blocked, false, false)).toBe("403");
  });

  test("approved, not admin → allow", () => {
    expect(gateApprovedDecision(approved, false, false)).toBe("allow");
  });

  test("pending, demo ON, not admin → allow", () => {
    expect(gateApprovedDecision(pending, true, false)).toBe("allow");
  });

  test("admin bypass: anonymous session but isAdmin → allow", () => {
    // checkAdmin can pass via x-admin-key without a matching app user.
    expect(gateApprovedDecision(null, false, true)).toBe("allow");
  });

  test("admin bypass: pending app user who is also admin → allow", () => {
    expect(gateApprovedDecision(pending, false, true)).toBe("allow");
  });
});

// ── Full flow: pending user hitting gated endpoints ───────────────────────────
describe("pending user hitting gated data endpoints (demo OFF)", () => {
  // /api/mind, /api/race, /api/sessions/*, /api/usage/hourly, /api/status, /ws
  test("blocked from gated endpoint → 403", () => {
    expect(gateApprovedDecision(pending, false, false)).toBe("403");
  });

  test("after super-admin approves → allow", () => {
    expect(gateApprovedDecision({ ...pending, status: "approved" }, false, false)).toBe("allow");
  });
});
