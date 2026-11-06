import fs   from "fs";
import path from "path";
import { config } from "../config";
import { dbSaveSetting, settings } from "../state";
import { bustCredentialCaches, refreshOauthToken } from "../upstream";
import {
  isCredentialFileName, listCredentials, setCredentialDisabled, setCredentialEmail, setCredentialLabel,
} from "../anthropicAccounts";
import { fetchProfileEmail } from "../oauthProfile";
import { triggerBroadcast } from "../broadcast";

// Counterpart of /api/admin/credentials/remove — without it, disabling an
// account is a one-way trapdoor.
export async function handleAccountEnable(req: Request): Promise<Response> {
  const body = await req.json().catch(() => null) as any;
  const file = body?.file as string | undefined;
  if (!file) return Response.json({ error: "Missing file" }, { status: 400 });

  const res = setCredentialDisabled(config.authDir, file, false);
  if (!res.ok) return Response.json({ error: res.error }, { status: res.badName ? 400 : 500 });

  bustCredentialCaches();
  triggerBroadcast();
  return Response.json({ ok: true, email: res.email });
}

// Pins which Anthropic account serves requests. Empty email = auto (first usable).
export async function handleAccountActivate(req: Request): Promise<Response> {
  const body  = await req.json().catch(() => null) as any;
  const email = String(body?.email ?? "").trim();

  if (email && !listCredentials(config.authDir).some(r => r.usable && r.email === email)) {
    return Response.json({ error: `No usable credential for ${email}` }, { status: 400 });
  }

  await dbSaveSetting("anthropic_account", email);
  bustCredentialCaches();
  triggerBroadcast();
  return Response.json({ ok: true, email });
}

export async function handleAccountLabel(req: Request): Promise<Response> {
  const body = await req.json().catch(() => null) as any;
  const file = String(body?.file ?? "");
  if (!file) return Response.json({ error: "Missing file" }, { status: 400 });

  const res = setCredentialLabel(config.authDir, file, String(body?.label ?? ""));
  if (!res.ok) return Response.json({ error: res.error }, { status: res.badInput ? 400 : 500 });

  triggerBroadcast();
  return Response.json({ ok: true, label: res.label });
}

// Fixes credentials saved under a fallback name. The file is NOT renamed — only its
// `email` field — so in-flight refreshes keep writing to the same path.
export async function handleAccountResolveEmail(req: Request): Promise<Response> {
  const body = await req.json().catch(() => null) as any;
  const file = String(body?.file ?? "");
  if (!isCredentialFileName(file)) return Response.json({ error: "Invalid file name" }, { status: 400 });

  const filePath = path.join(config.authDir, file);
  let cred: any;
  try { cred = JSON.parse(fs.readFileSync(filePath, "utf-8")); }
  catch (e: any) { return Response.json({ error: `Cannot read ${file}: ${e.message}` }, { status: 400 }); }
  if (!cred?.access_token) return Response.json({ error: `${file} has no access_token` }, { status: 400 });

  let profile = await fetchProfileEmail(cred.access_token);
  if (!profile.ok && profile.status === 401 && cred.refresh_token) {
    const fresh = await refreshOauthToken(filePath, cred.refresh_token);
    if (fresh) profile = await fetchProfileEmail(fresh);
  }
  if (!profile.ok) return Response.json({ ok: false, error: profile.error }, { status: 502 });

  const oldEmail = String(cred.email || file);
  const res = setCredentialEmail(config.authDir, file, profile.email);
  if (!res.ok) return Response.json({ ok: false, error: res.error }, { status: res.badInput ? 400 : 500 });

  const changed = oldEmail !== profile.email;
  if (changed && settings["anthropic_account"] === oldEmail) {
    await dbSaveSetting("anthropic_account", profile.email);
  }
  bustCredentialCaches();
  triggerBroadcast();
  return Response.json({ ok: true, email: profile.email, changed });
}
