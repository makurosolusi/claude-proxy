/**
 * Tests for anthropicAccounts.ts — multi-account credential selection.
 * Run: bun test tests/anthropicAccounts.test.ts
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs   from "fs";
import os   from "os";
import path from "path";
import {
  isCredentialFileName,
  listCredentials,
  pickCredential,
  setCredentialDisabled,
  setCredentialLabel,
  setCredentialEmail,
} from "../src/anthropicAccounts";

let dir: string;

function write(email: string, extra: Record<string, unknown> = {}) {
  const file = `claude-${email.replace(/[^a-zA-Z0-9._-]/g, "_")}.json`;
  fs.writeFileSync(path.join(dir, file), JSON.stringify({
    access_token: "at-" + email, refresh_token: "rt-" + email, email, disabled: false, ...extra,
  }));
  return file;
}

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "creds-")); });
afterEach(()  => { fs.rmSync(dir, { recursive: true, force: true }); });

describe("isCredentialFileName", () => {
  test("accepts claude-*.json", () => {
    expect(isCredentialFileName("claude-a@b.com.json")).toBe(true);
  });
  test("rejects traversal and foreign names", () => {
    expect(isCredentialFileName("../../etc/passwd")).toBe(false);
    expect(isCredentialFileName("claude-../x.json")).toBe(false);
    expect(isCredentialFileName("other.json")).toBe(false);
  });
});

describe("listCredentials", () => {
  test("sorted by file name — deterministic across filesystems", () => {
    write("zoe@x.com"); write("ann@x.com"); write("mid@x.com");
    expect(listCredentials(dir).map(r => r.email)).toEqual(["ann@x.com", "mid@x.com", "zoe@x.com"]);
  });

  test("marks disabled and token-less entries unusable", () => {
    write("ok@x.com");
    write("off@x.com", { disabled: true });
    write("broken@x.com", { refresh_token: "" });
    const byEmail = Object.fromEntries(listCredentials(dir).map(r => [r.email, r.usable]));
    expect(byEmail).toEqual({ "ok@x.com": true, "off@x.com": false, "broken@x.com": false });
  });

  test("skips unparseable files instead of throwing", () => {
    write("ok@x.com");
    fs.writeFileSync(path.join(dir, "claude-bad.json"), "{not json");
    expect(listCredentials(dir).map(r => r.email)).toEqual(["ok@x.com"]);
  });

  test("missing dir → empty", () => {
    expect(listCredentials(path.join(dir, "nope"))).toEqual([]);
  });
});

describe("pickCredential", () => {
  test("no pin → first usable in sorted order", () => {
    write("zoe@x.com"); write("ann@x.com");
    const { cred, warning } = pickCredential(dir, "");
    expect(cred?.email).toBe("ann@x.com");
    expect(cred?.token).toBe("at-ann@x.com");
    expect(warning).toBeNull();
  });

  test("pin selects that account even when not first", () => {
    write("ann@x.com"); write("zoe@x.com");
    const { cred, warning } = pickCredential(dir, "zoe@x.com");
    expect(cred?.email).toBe("zoe@x.com");
    expect(warning).toBeNull();
  });

  test("pin to disabled account falls back and warns", () => {
    write("ann@x.com"); write("zoe@x.com", { disabled: true });
    const { cred, warning } = pickCredential(dir, "zoe@x.com");
    expect(cred?.email).toBe("ann@x.com");
    expect(warning).toContain("zoe@x.com");
  });

  test("no files → error, no credential", () => {
    const { cred, error } = pickCredential(dir, "");
    expect(cred).toBeNull();
    expect(error).toContain("No claude-*.json");
  });

  test("all disabled → error, no credential", () => {
    write("ann@x.com", { disabled: true });
    const { cred, error } = pickCredential(dir, "");
    expect(cred).toBeNull();
    expect(error).toContain("disabled");
  });
});

describe("setCredentialDisabled", () => {
  test("disable then enable round trip", () => {
    const file = write("ann@x.com");
    expect(setCredentialDisabled(dir, file, true).ok).toBe(true);
    expect(listCredentials(dir)[0]!.usable).toBe(false);

    expect(setCredentialDisabled(dir, file, false).ok).toBe(true);
    expect(listCredentials(dir)[0]!.usable).toBe(true);
  });

  test("preserves other fields", () => {
    const file = write("ann@x.com");
    setCredentialDisabled(dir, file, true);
    const d = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8"));
    expect(d.access_token).toBe("at-ann@x.com");
    expect(d.updated_at).toBeTruthy();
  });

  test("rejects path traversal", () => {
    const res = setCredentialDisabled(dir, "../../etc/passwd", true);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.badName).toBe(true);
  });

  test("missing file → error, not throw", () => {
    expect(setCredentialDisabled(dir, "claude-ghost.json", true).ok).toBe(false);
  });
});

describe("listCredentials metadata", () => {
  test("label / created_at / last_refresh read from file fields", () => {
    write("ann@x.com", { label: "Team A", created_at: "2026-01-01T00:00:00.000Z", last_refresh: "2026-02-01T00:00:00.000Z" });
    const r = listCredentials(dir)[0]!;
    expect(r.label).toBe("Team A");
    expect(r.created_at).toBe("2026-01-01T00:00:00.000Z");
    expect(r.last_refresh).toBe("2026-02-01T00:00:00.000Z");
  });

  test("created_at derived from legacy claude-account-<ms>.json name", () => {
    fs.writeFileSync(path.join(dir, "claude-account-1793931005843.json"),
      JSON.stringify({ access_token: "a", refresh_token: "r", email: "account-1793931005843" }));
    const r = listCredentials(dir)[0]!;
    expect(r.created_at).toBe(new Date(1793931005843).toISOString());
    expect(r.label).toBe("");
    expect(r.last_refresh).toBeNull();
  });

  test("no created_at field and non-legacy name → null", () => {
    write("ann@x.com");
    expect(listCredentials(dir)[0]!.created_at).toBeNull();
  });
});

describe("setCredentialLabel", () => {
  test("sets trimmed label, then clears with empty string", () => {
    const file = write("ann@x.com");
    const res = setCredentialLabel(dir, file, "  Main account  ");
    expect(res).toEqual({ ok: true, label: "Main account" });
    expect(listCredentials(dir)[0]!.label).toBe("Main account");

    expect(setCredentialLabel(dir, file, "").ok).toBe(true);
    const d = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8"));
    expect("label" in d).toBe(false);
    expect(d.refresh_token).toBe("rt-ann@x.com");
  });

  test("label over 60 chars → badInput error, file untouched", () => {
    const file = write("ann@x.com");
    const res = setCredentialLabel(dir, file, "x".repeat(61));
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.badInput).toBe(true);
    expect(listCredentials(dir)[0]!.label).toBe("");
  });

  test("bad file name and missing file → badInput", () => {
    const bad = setCredentialLabel(dir, "../../etc/passwd", "x");
    expect(bad.ok === false && bad.badInput).toBe(true);
    const missing = setCredentialLabel(dir, "claude-ghost.json", "x");
    expect(missing.ok === false && missing.badInput).toBe(true);
  });
});

describe("setCredentialEmail", () => {
  test("writes email and preserves every other field incl. refresh_token", () => {
    const file = write("account-1", { label: "L", created_at: "2026-01-01T00:00:00.000Z" });
    const res = setCredentialEmail(dir, file, "real@x.com");
    expect(res).toEqual({ ok: true, email: "real@x.com" });
    const d = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8"));
    expect(d.email).toBe("real@x.com");
    expect(d.access_token).toBe("at-account-1");
    expect(d.refresh_token).toBe("rt-account-1");
    expect(d.label).toBe("L");
    expect(d.created_at).toBe("2026-01-01T00:00:00.000Z");
    expect(fs.readdirSync(dir)).toEqual([file]);
  });

  test("rejects bad file name", () => {
    const res = setCredentialEmail(dir, "../x.json", "a@x.com");
    expect(res.ok === false && res.badInput).toBe(true);
  });
});
