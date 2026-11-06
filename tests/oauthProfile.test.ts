/**
 * Tests for oauthProfile.ts — account email extraction.
 * Run: bun test tests/oauthProfile.test.ts
 */
import { describe, test, expect } from "bun:test";
import { emailFromTokenResponse, emailFromProfile, OAUTH_PROFILE_URL } from "../src/oauthProfile";

describe("emailFromTokenResponse", () => {
  test("reads account.email_address from token exchange response", () => {
    expect(emailFromTokenResponse({
      access_token: "x", account: { uuid: "u1", email_address: "ann@x.com" },
    })).toBe("ann@x.com");
  });
  test("accepts account.email variant", () => {
    expect(emailFromTokenResponse({ account: { email: "bob@x.com" } })).toBe("bob@x.com");
  });
  test("missing account / undefined input → empty string", () => {
    expect(emailFromTokenResponse({ access_token: "x" })).toBe("");
    expect(emailFromTokenResponse(undefined)).toBe("");
  });
});

describe("emailFromProfile", () => {
  test("reads account.email from profile response", () => {
    expect(emailFromProfile({ account: { uuid: "u1", email: "ann@x.com" }, organization: {} })).toBe("ann@x.com");
  });
  test("falls back to account.email_address, email, login_email", () => {
    expect(emailFromProfile({ account: { email_address: "a@x.com" } })).toBe("a@x.com");
    expect(emailFromProfile({ email: "b@x.com" })).toBe("b@x.com");
    expect(emailFromProfile({ login_email: "c@x.com" })).toBe("c@x.com");
  });
  test("missing → empty string", () => {
    expect(emailFromProfile({ account: {} })).toBe("");
    expect(emailFromProfile(null)).toBe("");
  });
});

test("profile URL is the /api/oauth/profile route (old /api/auth/oauth/profile 404s)", () => {
  expect(OAUTH_PROFILE_URL).toBe("https://api.anthropic.com/api/oauth/profile");
});
