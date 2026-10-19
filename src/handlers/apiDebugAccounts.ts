import { config }   from "../config";
import { settings } from "../state";
import { listCredentials, pickCredential } from "../anthropicAccounts";
import { getOauthCredential, hasAnthropicCredential } from "../upstream";

function checkMcpSecret(req: Request): boolean {
  if (!config.mcpSecret) return false;
  const token = req.headers.get("x-mcp-secret") || req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return token === config.mcpSecret;
}

// GET /api/debug/anthropic-accounts — which Claude account is pinned vs actually
// serving. Never emits token material: only `usable` presence flags.
export function handleDebugAnthropicAccounts(req: Request): Response {
  if (!checkMcpSecret(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const pinnedEmail  = settings["anthropic_account"] || "";
  const servingEmail = getOauthCredential()?.email ?? null;
  const { warning, error } = pickCredential(config.authDir, pinnedEmail);

  const accounts = listCredentials(config.authDir).map(r => ({
    file:     r.file,
    email:    r.email,
    disabled: r.disabled,
    usable:   r.usable,
    pinned:   !!pinnedEmail && r.email === pinnedEmail,
    serving:  r.email === servingEmail,
  }));

  return Response.json({
    auth_dir:                 config.authDir,
    has_anthropic_credential: hasAnthropicCredential(),
    pinned_email:             pinnedEmail || null,
    serving_email:            servingEmail,
    // true when a pin is set but a different account is actually serving it
    pin_fallback_active:      !!pinnedEmail && !!servingEmail && servingEmail !== pinnedEmail,
    warning,
    error,
    total:                    accounts.length,
    usable_count:             accounts.filter(a => a.usable).length,
    accounts,
  });
}
