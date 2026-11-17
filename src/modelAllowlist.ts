// Per-token model allowlist. Order = priority: allowed[0] is the redirect target
// for any model not in the list.
export type ModelResolution = { model: string; redirected: boolean };

// Requested model outside the list is redirected, never rejected: Claude Code
// hardcodes haiku for background tasks, so a 400 would kill those silently.
export function resolveModel(requested: string, allowed: string[]): ModelResolution {
  const list = normalizeAllowed(allowed);
  if (list.length === 0) return { model: requested, redirected: false };
  if (list.includes(requested)) return { model: requested, redirected: false };
  return { model: list[0]!, redirected: true };
}

export function normalizeAllowed(raw: string[] | string): string[] {
  const parts = Array.isArray(raw) ? raw : raw.split(",");
  const out: string[] = [];
  for (const p of parts) {
    const m = String(p).trim();
    if (!m || out.includes(m)) continue;
    out.push(m);
  }
  return out;
}

// Bulk switch: `to` empty or already listed collapses to a removal, so the
// result never duplicates a model or moves an existing one out of priority.
export function swapModel(allowed: string[], from: string, to: string): string[] {
  const i = from ? allowed.indexOf(from) : -1;
  if (i === -1 || to === from) return allowed;
  if (!to || allowed.includes(to)) return allowed.filter((_, n) => n !== i);
  return allowed.map((m, n) => (n === i ? to : m));
}

export function derivePinnedModel(allowed: string[]): string {
  const list = normalizeAllowed(allowed);
  return list.length === 1 ? list[0]! : "";
}
