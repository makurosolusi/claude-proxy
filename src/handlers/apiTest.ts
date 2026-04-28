import { config } from "../config";
import { tokens }  from "../state";
import { getOauthCredential } from "../upstream";

interface TestResult {
  ok:      boolean;
  latency: number;
  detail:  string;
  error?:  string;
}

export async function handleApiTest(): Promise<Response> {
  const results: Record<string, TestResult> = {};

  // ── 1. Credential file ────────────────────────────────────────────────────
  const t0 = Date.now();
  const cred = getOauthCredential();
  results.credential = cred
    ? { ok: true,  latency: Date.now() - t0, detail: `email: ${cred.email}` }
    : { ok: false, latency: Date.now() - t0, detail: "No claude-*.json found", error: "Credential missing" };

  // ── 2. Usage / quota endpoint ─────────────────────────────────────────────
  if (cred) {
    const t1 = Date.now();
    try {
      const r = await fetch("https://api.anthropic.com/api/oauth/usage", {
        headers: {
          "Authorization":  "Bearer " + cred.token,
          "anthropic-beta": "oauth-2025-04-20",
          "Accept":         "application/json",
        },
        signal: AbortSignal.timeout(8000),
      });
      const lat = Date.now() - t1;
      if (r.ok) {
        const d = await r.json() as any;
        const util = d?.five_hour?.utilization;
        results.usage = {
          ok: true, latency: lat,
          detail: util != null ? `5h utilization: ${util.toFixed(1)}%` : "ok",
        };
      } else {
        results.usage = { ok: false, latency: lat, detail: `HTTP ${r.status}`, error: `HTTP ${r.status}` };
      }
    } catch (e: any) {
      results.usage = { ok: false, latency: Date.now() - t1, detail: e.message, error: e.message };
    }
  } else {
    results.usage = { ok: false, latency: 0, detail: "Skipped — no credential", error: "No credential" };
  }

  // ── 3. Messages API (real request, minimal tokens) ────────────────────────
  const firstKey = Object.keys(tokens)[0];
  if (firstKey && cred) {
    const t2 = Date.now();
    try {
      const r = await fetch(config.anthropicUrl + "/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type":    "application/json",
          "authorization":   "Bearer " + cred.token,
          "anthropic-version": "2023-06-01",
          "anthropic-beta":  "oauth-2025-04-20",
        },
        body: JSON.stringify({
          model:      "claude-haiku-4-5-20251001",
          max_tokens: 12,
          messages:   [{ role: "user", content: "Reply with exactly the word: CONNECTED" }],
        }),
        signal: AbortSignal.timeout(15000),
      });
      const lat = Date.now() - t2;
      if (r.ok) {
        const d = await r.json() as any;
        const text = d?.content?.[0]?.text ?? "ok";
        const toks = (d?.usage?.input_tokens ?? 0) + (d?.usage?.output_tokens ?? 0);
        results.messages = { ok: true, latency: lat, detail: `"${text.slice(0, 30)}" · ${toks} tokens` };
      } else {
        const d = await r.json().catch(() => ({})) as any;
        const msg = d?.error?.message ?? `HTTP ${r.status}`;
        results.messages = { ok: false, latency: lat, detail: msg, error: msg };
      }
    } catch (e: any) {
      results.messages = { ok: false, latency: Date.now() - t2, detail: e.message, error: e.message };
    }
  } else {
    results.messages = { ok: false, latency: 0, detail: "No tokens configured", error: "No tokens" };
  }

  const allOk = Object.values(results).every(r => r.ok);
  return Response.json({ ok: allOk, results, ts: new Date().toISOString() });
}
