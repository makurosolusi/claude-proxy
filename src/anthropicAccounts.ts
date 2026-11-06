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
  label:        string;
  created_at:   string | null;
  last_refresh: string | null;
}

export interface PickResult {
  cred:    OauthCredential | null;
  error:   string | null;
  warning: string | null;
}

const CRED_FILE_RE = /^claude-[\w@._+-]+\.json$/;
const FALLBACK_FILE_RE = /^claude-account-(\d{13})\.json$/;
export const MAX_LABEL_LEN = 60;

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
        label:        typeof d.label === "string" ? d.label : "",
        created_at:   d.created_at || createdAtFromFileName(file),
        last_refresh: d.last_refresh || null,
      }];
    } catch {
      return [];
    }
  });
}

// Legacy fallback names embed the creation time: claude-account-<ms epoch>.json.
function createdAtFromFileName(file: string): string | null {
  const m = FALLBACK_FILE_RE.exec(file);
  return m ? new Date(Number(m[1])).toISOString() : null;
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

// badInput = caller's fault (bad name, too-long label, missing file) → HTTP 400.
export type CredentialWriteError = { ok: false; error: string; badInput?: true };

// Read→mutate→write MUST stay synchronous with no await: doRefresh() rewrites the same
// file with a rotated single-use refresh token, and a stale copy written back kills the account.
function updateCredentialFile(
  dir: string, file: string, mutate: (d: any) => void,
): { ok: true; email: string } | CredentialWriteError {
  if (!isCredentialFileName(file)) {
    return { ok: false, error: "Invalid file name", badInput: true };
  }
  const filePath = path.join(dir, file);
  if (!fs.existsSync(filePath)) {
    return { ok: false, error: `Credential ${file} not found`, badInput: true };
  }
  try {
    const d = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    mutate(d);
    d.updated_at = new Date().toISOString();
    fs.writeFileSync(filePath, JSON.stringify(d, null, 2), "utf-8");
    return { ok: true, email: d.email || file };
  } catch (e: any) {
    return { ok: false, error: `Update ${file} failed: ${e.message}` };
  }
}

export function setCredentialLabel(
  dir: string, file: string, label: string,
): { ok: true; label: string } | CredentialWriteError {
  const clean = label.trim();
  if (clean.length > MAX_LABEL_LEN) {
    return { ok: false, error: `Label too long (max ${MAX_LABEL_LEN} chars)`, badInput: true };
  }
  const res = updateCredentialFile(dir, file, d => {
    if (clean) d.label = clean; else delete d.label;
  });
  return res.ok ? { ok: true, label: clean } : res;
}

export function setCredentialEmail(
  dir: string, file: string, email: string,
): { ok: true; email: string } | CredentialWriteError {
  return updateCredentialFile(dir, file, d => { d.email = email; });
}
