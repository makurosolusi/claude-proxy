/**
 * Tests for RequireAuth and RequireLogin decision logic.
 * Pure function mirrors of the component logic in shared.tsx — no DOM needed.
 * Run: bun test tests/authGate.test.ts
 */
import { describe, test, expect } from "bun:test";

type ProfileLike = {
  authenticated?: boolean;
  status?: string;
  role?: string;
} | null | "loading";

// ── Mirrors RequireAuth in shared.tsx ─────────────────────────────────────────
function requireAuthDecision(
  profile: ProfileLike,
): "loading" | "redirect:/login" | "redirect:/diblokir" | "redirect:/profile" | "allow" {
  if (profile === "loading")        return "loading";
  if (!profile?.authenticated)      return "redirect:/login";
  if (profile.status === "blocked") return "redirect:/diblokir";
  if (profile.status === "pending") return "redirect:/profile";   // ← the fix
  return "allow";
}

// ── Mirrors RequireLogin in shared.tsx ────────────────────────────────────────
function requireLoginDecision(
  profile: ProfileLike,
): "loading" | "redirect:/login" | "allow" {
  if (profile === "loading")   return "loading";
  if (!profile?.authenticated) return "redirect:/login";
  return "allow";              // pending/blocked pass through — only login matters
}

// ── RequireAuth ───────────────────────────────────────────────────────────────
describe("RequireAuth", () => {
  test("loading → show loading screen", () => {
    expect(requireAuthDecision("loading")).toBe("loading");
  });

  test("null profile → redirect /login", () => {
    expect(requireAuthDecision(null)).toBe("redirect:/login");
  });

  test("not authenticated → redirect /login", () => {
    expect(requireAuthDecision({ authenticated: false })).toBe("redirect:/login");
  });

  test("authenticated + pending → redirect /profile (not /menunggu)", () => {
    expect(requireAuthDecision({ authenticated: true, status: "pending" })).toBe("redirect:/profile");
  });

  test("authenticated + blocked → redirect /diblokir", () => {
    expect(requireAuthDecision({ authenticated: true, status: "blocked" })).toBe("redirect:/diblokir");
  });

  test("authenticated + approved → allow", () => {
    expect(requireAuthDecision({ authenticated: true, status: "approved" })).toBe("allow");
  });

  test("authenticated + no status field → allow (default)", () => {
    expect(requireAuthDecision({ authenticated: true })).toBe("allow");
  });
});

// ── RequireLogin ──────────────────────────────────────────────────────────────
describe("RequireLogin", () => {
  test("loading → show loading screen", () => {
    expect(requireLoginDecision("loading")).toBe("loading");
  });

  test("null → redirect /login", () => {
    expect(requireLoginDecision(null)).toBe("redirect:/login");
  });

  test("not authenticated → redirect /login", () => {
    expect(requireLoginDecision({ authenticated: false })).toBe("redirect:/login");
  });

  test("authenticated + pending → allow (can access /profile)", () => {
    expect(requireLoginDecision({ authenticated: true, status: "pending" })).toBe("allow");
  });

  test("authenticated + blocked → allow (RequireLogin only checks login)", () => {
    expect(requireLoginDecision({ authenticated: true, status: "blocked" })).toBe("allow");
  });

  test("authenticated + approved → allow", () => {
    expect(requireLoginDecision({ authenticated: true, status: "approved" })).toBe("allow");
  });
});

// ── Full flow: pending user journey ──────────────────────────────────────────
describe("pending user full journey", () => {
  const pendingUser = { authenticated: true, status: "pending" };

  test('tries "/" → redirected to /profile', () => {
    expect(requireAuthDecision(pendingUser)).toBe("redirect:/profile");
  });

  test('tries "/profile" → allowed in', () => {
    expect(requireLoginDecision(pendingUser)).toBe("allow");
  });

  test('tries "/notifications" → redirected to /profile', () => {
    // /notifications also uses RequireAuth
    expect(requireAuthDecision(pendingUser)).toBe("redirect:/profile");
  });
});

// ── Full flow: unauthenticated user ───────────────────────────────────────────
describe("unauthenticated user full journey", () => {
  const noUser = { authenticated: false };

  test('tries "/" → redirect /login', () => {
    expect(requireAuthDecision(noUser)).toBe("redirect:/login");
  });

  test('tries "/profile" → redirect /login (RequireLogin protects it)', () => {
    expect(requireLoginDecision(noUser)).toBe("redirect:/login");
  });
});
