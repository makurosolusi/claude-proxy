import { config } from "../config";
import { dbSaveSetting } from "../state";
import { bustCredentialCaches } from "../upstream";
import { listCredentials, setCredentialDisabled } from "../anthropicAccounts";
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
