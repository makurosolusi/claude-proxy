export const OAUTH_PROFILE_URL = "https://api.anthropic.com/api/oauth/profile";

export type ProfileEmailResult = { ok: true; email: string } | { ok: false; status: number; error: string };

// Token exchange/refresh responses carry `account: { uuid, email_address }`.
export function emailFromTokenResponse(data: any): string {
  return data?.account?.email_address || data?.account?.email || "";
}

export function emailFromProfile(data: any): string {
  return data?.account?.email || data?.account?.email_address || data?.email || data?.login_email || "";
}

// status 0 = network failure (no HTTP response).
export async function fetchProfileEmail(accessToken: string): Promise<ProfileEmailResult> {
  let resp: Response;
  try {
    resp = await fetch(OAUTH_PROFILE_URL, {
      headers: { "Authorization": "Bearer " + accessToken, "anthropic-beta": "oauth-2025-04-20" },
    });
  } catch (e: any) {
    return { ok: false, status: 0, error: `Profile fetch network error: ${e?.message ?? e}` };
  }
  if (!resp.ok) {
    const body = await resp.text().catch(e => `<unreadable body: ${e?.message ?? e}>`);
    return { ok: false, status: resp.status, error: `Profile HTTP ${resp.status}: ${body.slice(0, 200)}` };
  }
  let data: any;
  try { data = await resp.json(); }
  catch (e: any) { return { ok: false, status: resp.status, error: `Profile response not JSON: ${e?.message ?? e}` }; }
  const email = emailFromProfile(data);
  return email
    ? { ok: true, email }
    : { ok: false, status: resp.status, error: "Profile response has no email field" };
}
