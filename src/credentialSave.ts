import fs   from "fs";
import path from "path";
import { config } from "./config";
import { bustCredentialCaches } from "./upstream";
import { listCredentials } from "./anthropicAccounts";
import { emailFromTokenResponse, fetchProfileEmail } from "./oauthProfile";

export async function resolveEmail(accessToken: string, tokenData?: any): Promise<string> {
  const fromToken = emailFromTokenResponse(tokenData);
  if (fromToken) return fromToken;
  const profile = await fetchProfileEmail(accessToken);
  if (profile.ok) return profile.email;
  console.warn(`[auth] Account email unresolved (${profile.error}) — using fallback file name`);
  return `account-${Date.now()}`;
}

// Re-login of a known account must update its existing file, not mint a duplicate.
function credentialTarget(email: string): { file: string; createdAt: string | null } {
  const existing = email.includes("@")
    ? listCredentials(config.authDir).find(r => r.email === email)
    : undefined;
  if (existing) return { file: existing.file, createdAt: existing.created_at };
  return { file: `claude-${email.replace(/[^a-zA-Z0-9._-]/g, "_")}.json`, createdAt: null };
}

function readExisting(filePath: string): any {
  if (!fs.existsSync(filePath)) return {};
  try { return JSON.parse(fs.readFileSync(filePath, "utf-8")); }
  catch (e: any) {
    console.warn(`[auth] ${path.basename(filePath)} unparseable, overwriting: ${e.message}`);
    return {};
  }
}

/** Writes the credential file for `email`, merging over its existing content via `build`. */
export function writeCredential(
  email: string,
  build: (existing: any, targetCreatedAt: string | null, now: string) => object,
): { ok: true; file: string } | { ok: false; error: string } {
  const target   = credentialTarget(email);
  const filePath = path.join(config.authDir, target.file);

  try {
    fs.mkdirSync(config.authDir, { recursive: true });
    // Read→write must stay synchronous (no await between): doRefresh rotates single-use
    // refresh tokens, and writing back a stale copy would kill the account.
    const existing = readExisting(filePath);
    const now = new Date().toISOString();
    fs.writeFileSync(filePath, JSON.stringify(build(existing, target.createdAt, now), null, 2), "utf-8");
  } catch (e: any) {
    return { ok: false, error: "Save failed: " + e.message };
  }

  bustCredentialCaches();
  return { ok: true, file: target.file };
}
