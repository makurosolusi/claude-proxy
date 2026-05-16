import { config } from "../../config";
import { getOauthCredential } from "../../upstream";

export interface DistilledStrategy {
  title:        string;
  when_to_use:  string;
  key_steps:    string[];
  pitfalls:     string[];
  tags:         string[];
  skip?:        false;
}

export interface SkippedDistillation {
  skip:   true;
  reason: string;
}

export type DistillResult = DistilledStrategy | SkippedDistillation;

const DISTILL_SYSTEM = `You are a strategy distiller. Read a coding-session trajectory and distill ONE reusable, high-level strategy item. Output ONLY valid JSON, no preamble, no markdown fences.

Schema for valid strategy:
{
  "title": "imperative phrase (max 80 chars)",
  "when_to_use": "trigger conditions (max 200 chars)",
  "key_steps": ["step", ...] (max 5, each <120 chars),
  "pitfalls": ["pitfall", ...] (max 3, each <120 chars),
  "tags": ["tag", ...] (max 4, single-word lowercase)
}

Schema when trajectory is unsuitable (short, error-only, chitchat, throwaway):
{ "skip": true, "reason": "..." }

Skip if:
- Trajectory is <100 chars total
- Session is just error messages or stack traces
- Conversational/help-desk only (no concrete pattern)
- One-off question without reusable insight`;

function buildUserPrompt(trajectory: string, response: string): string {
  return `Trajectory:
${trajectory.slice(0, 6000)}

Final assistant response:
${response.slice(0, 2000)}

Distill ONE reusable strategy. JSON only.`;
}

export async function callClaudeForDistillation(trajectory: string, response: string, model: string): Promise<string> {
  const cred = getOauthCredential();
  if (!cred) throw new Error("no anthropic credential — connect a Claude account in admin/Accounts");
  const userPrompt = buildUserPrompt(trajectory, response);
  const r = await fetch(config.anthropicUrl + "/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type":      "application/json",
      "Authorization":     "Bearer " + cred.token,
      "anthropic-version": "2023-06-01",
      "anthropic-beta":    "oauth-2025-04-20",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system: DISTILL_SYSTEM,
      messages: [{ role: "user", content: userPrompt }],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) {
    const err = await r.text().catch(() => "");
    throw new Error(`Claude ${r.status}: ${err.slice(0, 200)}`);
  }
  const d = await r.json() as any;
  return d?.content?.[0]?.text || "";
}

export function parseDistillation(text: string): DistillResult | null {
  if (!text) return null;
  let cleaned = text.trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "");
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed?.skip === true) {
      return { skip: true, reason: String(parsed.reason || "no reason").slice(0, 200) };
    }
    if (!parsed?.title || typeof parsed.title !== "string") return null;
    return {
      title:        String(parsed.title).slice(0, 80),
      when_to_use:  String(parsed.when_to_use || "").slice(0, 200),
      key_steps:    Array.isArray(parsed.key_steps) ? parsed.key_steps.slice(0, 5).map((s: any) => String(s).slice(0, 120)) : [],
      pitfalls:     Array.isArray(parsed.pitfalls)  ? parsed.pitfalls.slice(0, 3).map((s: any) => String(s).slice(0, 120)) : [],
      tags:         Array.isArray(parsed.tags)      ? parsed.tags.slice(0, 4).map((s: any) => String(s).toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 24)).filter(Boolean) : [],
    };
  } catch {
    return null;
  }
}

export async function distillStrategy(trajectory: string, response: string, model: string): Promise<DistillResult | null> {
  const raw = await callClaudeForDistillation(trajectory, response, model);
  return parseDistillation(raw);
}
