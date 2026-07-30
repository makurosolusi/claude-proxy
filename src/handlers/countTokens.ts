import { config } from "../config";
import { getOauthCredential, hasAnthropicCredential } from "../upstream";

// Forward POST /v1/messages/count_tokens to Anthropic so clients get a real count.
// Anthropic-only: no other provider exposes an equivalent endpoint. Without a
// credential (or on upstream failure) we fall back to 0 — the historical stub —
// so token counting never blocks a request.
export async function handleCountTokens(req: Request): Promise<Response> {
  if (!hasAnthropicCredential()) return Response.json({ input_tokens: 0 });

  const cred = getOauthCredential();
  if (!cred) return Response.json({ input_tokens: 0 });

  let bodyText: string;
  try {
    bodyText = await req.text();
  } catch {
    return Response.json({ input_tokens: 0 });
  }

  const headers = new Headers();
  headers.set("authorization", "Bearer " + cred.token);
  headers.set("anthropic-version", "2023-06-01");
  headers.set("anthropic-beta", "oauth-2025-04-20");
  headers.set("content-type", "application/json");

  try {
    const resp = await fetch(config.anthropicUrl + "/v1/messages/count_tokens", {
      method: "POST",
      headers,
      body: bodyText,
    });
    if (!resp.ok) {
      console.log(`[count_tokens] upstream ${resp.status} — falling back to 0`);
      return Response.json({ input_tokens: 0 });
    }
    const data: any = await resp.json();
    const n = Number(data?.input_tokens);
    return Response.json({ input_tokens: Number.isFinite(n) ? n : 0 });
  } catch (e: any) {
    console.log(`[count_tokens] upstream failed: ${e?.message ?? e} — falling back to 0`);
    return Response.json({ input_tokens: 0 });
  }
}
