import { config } from "../config";
import { prisma } from "../prisma";

function checkMcpSecret(req: Request): boolean {
  if (!config.mcpSecret) return false;
  const token = req.headers.get("x-mcp-secret") || req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return token === config.mcpSecret;
}

const MODE_SQL: Record<string, string> = {
  unrestricted: "= 0",
  pinned:       "= 1",
  multi:        ">= 2",
};

function modeOf(n: number): string {
  return n === 0 ? "unrestricted" : n === 1 ? "pinned" : "multi";
}

// GET /api/debug/token-models — inspect per-token model allowlists without admin UI.
// Shows which tokens are multi-model, which are still single-pin, which are unrestricted.
export async function handleDebugTokenModels(req: Request, url: URL): Promise<Response> {
  if (!checkMcpSecret(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const limit    = Math.max(1, Math.min(parseInt(url.searchParams.get("limit") || "50") || 50, 200));
  const keySuffix = (url.searchParams.get("key") || "").trim();
  const mode      = (url.searchParams.get("mode") || "").trim();
  if (mode && !MODE_SQL[mode]) {
    return Response.json({ error: `Invalid mode "${mode}" — expected unrestricted | pinned | multi` }, { status: 400 });
  }

  const where: string[] = ["deleted = false"];
  const params: unknown[] = [];
  let i = 1;
  if (keySuffix) {
    const p = i++;
    where.push(`right(key, length($${p}::text)) = $${p}::text`);
    params.push(keySuffix);
  }
  if (mode) where.push(`COALESCE(cardinality(allowed_models), 0) ${MODE_SQL[mode]}`);

  const sql = `SELECT key, label, user_id, provider, allowed_models, pinned_model
                 FROM tokens
                WHERE ${where.join(" AND ")}
                ORDER BY COALESCE(cardinality(allowed_models), 0) DESC, key
                LIMIT $${i++}`;

  const [rows, spread] = await Promise.all([
    prisma.$queryRawUnsafe<any[]>(sql, ...params, limit),
    prisma.$queryRawUnsafe<any[]>(
      `SELECT COALESCE(cardinality(allowed_models), 0) AS n, COUNT(*)::int AS c
         FROM tokens WHERE deleted = false GROUP BY 1`,
    ),
  ]);

  const counts = { unrestricted: 0, pinned: 0, multi: 0, total: 0 };
  for (const r of spread) {
    const c = Number(r.c);
    counts[modeOf(Number(r.n)) as "unrestricted" | "pinned" | "multi"] += c;
    counts.total += c;
  }

  return Response.json({
    returned: rows.length,
    limit,
    filter: { key_suffix: keySuffix || null, mode: mode || null },
    counts, // scope: all non-deleted tokens, unaffected by filters above
    tokens: rows.map(r => {
      const allowed: string[] = r.allowed_models ?? [];
      return {
        key_masked:     `…${String(r.key).slice(-6)}`,
        label:          r.label,
        user_id:        r.user_id,
        provider:       r.provider,
        allowed_models: allowed,
        pinned_model:   r.pinned_model,
        mode:           modeOf(allowed.length),
        // pinned_model is a derived mirror; drift means a write path skipped it.
        mirror_ok:      r.pinned_model === (allowed.length === 1 ? allowed[0] : ""),
      };
    }),
  });
}
