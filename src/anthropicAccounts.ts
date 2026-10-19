import fs   from "fs";
import path from "path";

export interface OauthCredential {
  token:        string;
  filePath:     string;
  refreshToken: string;
  email:        string;
}

// Deliberately carries no token — this shape is returned by the admin API.
export interface CredentialRecord {
  file:     string;
  filePath: string;
  email:    string;
  disabled: boolean;
  usable:   boolean;
}

export interface PickResult {
  cred:    OauthCredential | null;
  error:   string | null;
  warning: string | null;
}

const CRED_FILE_RE = /^claude-[\w@._+-]+\.json$/;

export function isCredentialFileName(file: string): boolean {
  return CRED_FILE_RE.test(file);
}

// Sorted: readdir order is filesystem-dependent, so without this the "first
// usable account" differs between APFS and ext4 for the same credential set.
export function listCredentials(dir: string): CredentialRecord[] {
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter(isCredentialFileName).sort();
  } catch {
    return [];
  }
  return files.flatMap(file => {
    const filePath = path.join(dir, file);
    try {
      const d = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      return [{
        file,
        filePath,
        email:    d.email || file,
        disabled: !!d.disabled,
        usable:   !d.disabled && !!d.access_token && !!d.refresh_token,
      }];
    } catch {
      return [];
    }
  });
}

function readCredential(rec: CredentialRecord): OauthCredential | null {
  try {
    const d = JSON.parse(fs.readFileSync(rec.filePath, "utf-8"));
    if (d.disabled || !d.access_token || !d.refresh_token) return null;
    return {
      token:        d.access_token,
      filePath:     rec.filePath,
      refreshToken: d.refresh_token,
      email:        d.email || rec.file,
    };
  } catch {
    return null;
  }
}

// activeEmail "" = no preference → first usable account in sorted order.
// A pinned account that is missing or unusable falls back to the first usable
// one instead of taking Anthropic offline; `warning` lets the caller log that.
export function pickCredential(dir: string, activeEmail: string): PickResult {
  const records = listCredentials(dir);
  if (!records.length) {
    return { cred: null, error: `No claude-*.json in ${dir}`, warning: null };
  }

  const usable = records.filter(r => r.usable);
  if (!usable.length) {
    return { cred: null, error: "All credentials disabled or missing tokens", warning: null };
  }

  const pinned = activeEmail ? usable.find(r => r.email === activeEmail) : undefined;
  const chosen = pinned ?? usable[0]!;
  const cred   = readCredential(chosen);
  if (!cred) {
    return { cred: null, error: `Credential ${chosen.file} became unreadable`, warning: null };
  }

  return {
    cred,
    error:   null,
    warning: activeEmail && !pinned
      ? `Pinned account ${activeEmail} unavailable — serving ${cred.email}`
      : null,
  };
}

export function setCredentialDisabled(
  dir: string, file: string, disabled: boolean,
): { ok: true; email: string } | { ok: false; error: string; badName?: true } {
  if (!isCredentialFileName(file)) {
    return { ok: false, error: "Invalid file name", badName: true };
  }
  const filePath = path.join(dir, file);
  try {
    const d = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    d.disabled   = disabled;
    d.updated_at = new Date().toISOString();
    fs.writeFileSync(filePath, JSON.stringify(d, null, 2), "utf-8");
    return { ok: true, email: d.email || file };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}
