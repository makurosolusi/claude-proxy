import { modelRoutes, dbSaveRoutes } from "../state";
import type { ModelRoute } from "../types";

export const KNOWN_MODELS = [
  "*",
  "claude-sonnet-4-6",
  "claude-opus-4-7",
  "claude-haiku-4-5-20251001",
] as const;

function validateRoutes(routes: ModelRoute[]): string | null {
  const ids = new Set<string>();
  for (const r of routes) {
    if (!r.model_id || typeof r.model_id !== "string") return "Each route requires a model_id.";
    if (ids.has(r.model_id)) return `Duplicate model_id: ${r.model_id}`;
    ids.add(r.model_id);
    if (typeof r.threshold !== "number" || r.threshold <= 0 || r.threshold > 1) return `${r.model_id}: threshold must be 0–1.`;
    if (r.action !== "redirect" && r.action !== "block") return `${r.model_id}: action must be "redirect" or "block".`;
    if (r.action === "redirect" && (!r.fallback_to || typeof r.fallback_to !== "string")) return `${r.model_id}: redirect requires fallback_to.`;
    if (r.action === "redirect" && r.fallback_to === "*") return `${r.model_id}: "*" is not a valid fallback model.`;
  }

  // Cycle detection: traverse each redirect chain
  for (const r of routes) {
    if (r.action !== "redirect" || !r.fallback_to) continue;
    const visited = new Set<string>();
    let cur: string | null = r.model_id;
    while (cur) {
      if (visited.has(cur)) return `Circular route detected involving ${r.model_id}.`;
      visited.add(cur);
      const next = routes.find(x => x.model_id === cur);
      if (!next || next.action !== "redirect" || !next.fallback_to) break;
      cur = next.fallback_to;
    }
  }

  return null;
}

export async function handleApiModelRoutes(req: Request, url: URL): Promise<Response> {
  if (req.method === "GET") {
    const list = Object.values(modelRoutes);
    return Response.json(list);
  }

  if (req.method === "POST") {
    let body: ModelRoute[];
    try {
      body = (await req.json()) as ModelRoute[];
      if (!Array.isArray(body)) throw new Error("Expected array");
    } catch {
      return Response.json({ error: "Invalid JSON — expected array of ModelRoute." }, { status: 400 });
    }

    const err = validateRoutes(body);
    if (err) return Response.json({ error: err }, { status: 400 });

    dbSaveRoutes(body);
    return Response.json({ ok: true });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
}
