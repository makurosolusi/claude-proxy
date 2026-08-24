// Transient upstream-overload retry policy.
//
// WHY: Anthropic returns HTTP 529 with an `overloaded_error` body when its
// capacity is momentarily saturated. This is transient and safe to retry —
// direct API clients (Claude Code, official SDKs) retry it automatically with
// backoff, so a blip is invisible to them. The proxy previously forwarded the
// 529 straight to the client, so the same blip that direct clients silently
// absorb surfaced as a hard failure ("Overloaded") through the proxy. This
// module mirrors the direct-client behavior: a few jittered retries before
// giving up and surfacing the error.

export const OVERLOAD_STATUS = 529;
export const MAX_OVERLOAD_RETRIES = 4;

// Anthropic uses status 529 specifically for overloaded_error.
export function isOverloadStatus(status: number): boolean {
  return status === OVERLOAD_STATUS;
}

// Broader detection for gateways that rewrite the status but keep the body,
// or mid-flight `error` events. Safe to call on any parsed JSON error body.
export function isOverloadError(status: number, body: any): boolean {
  if (isOverloadStatus(status)) return true;
  const type = body?.error?.type ?? body?.type;
  if (type === "overloaded_error") return true;
  const msg = String(body?.error?.message ?? body?.message ?? "").toLowerCase();
  return msg.includes("overloaded");
}

// Exponential backoff with full jitter. attempt is 0-indexed. `rand` is
// injectable for deterministic tests. Returns milliseconds in [0, exp].
export function overloadBackoffMs(
  attempt: number,
  base = 500,
  cap = 8000,
  rand: () => number = Math.random,
): number {
  const exp = Math.min(cap, base * 2 ** Math.max(0, attempt));
  return Math.floor(rand() * exp);
}

// Resolve the wait before the next retry: honor upstream `retry-after` (seconds,
// clamped to 10s) when present, otherwise fall back to jittered backoff.
export function overloadDelayMs(
  attempt: number,
  retryAfterHeader: string | null,
  rand: () => number = Math.random,
): number {
  const ra = parseInt(retryAfterHeader || "", 10);
  if (Number.isFinite(ra) && ra > 0) return Math.min(ra * 1000, 10_000);
  return overloadBackoffMs(attempt, 500, 8000, rand);
}
