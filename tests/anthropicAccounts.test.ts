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
