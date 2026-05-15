import { prisma } from "../prisma";
import { loadFromDb, backfillUsers, tokens, users, upstream, settings, dbSaveSetting } from "../state";

// ── Sync token store ──────────────────────────────────────────────────────────
// Tokens persist indefinitely AND survive restarts (stored in `settings`
// under SYNC_TOKENS_KEY as JSON). Super-admin revokes manually.
// Single-operator instance — no concurrency hazards with this approach.

interface SyncToken {
  token:      string;
  created_at: number;
}

const SYNC_TOKENS_KEY = "sync_tokens_v1";
const syncTokens = new Map<string, SyncToken>();

// Hydrate in-memory map from persisted settings. Called once from index.tsx
// after the main state.loadFromDb() populates the `settings` cache.
export function loadSyncTokens() {
  syncTokens.clear();
  const raw = settings[SYNC_TOKENS_KEY];
  if (!raw) return;
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return;
    for (const t of arr) {
      if (t && typeof t.token === "string" && typeof t.created_at === "number") {
        syncTokens.set(t.token, t);
      }
    }
  } catch {}
}

// Fire-and-forget persistence. Failure here doesn't block the response —
// worst case is a token that works in-memory until next restart.
function persistAsync() {
  const arr = [...syncTokens.values()];
  dbSaveSetting(SYNC_TOKENS_KEY, JSON.stringify(arr)).catch(e =>
    console.error("[apiDbSync] persist failed:", e.message)
  );
}

export function generateSyncToken(): SyncToken {
  const token      = "sync-" + crypto.randomUUID().replace(/-/g, "");
  const entry: SyncToken = { token, created_at: Date.now() };
  syncTokens.set(token, entry);
  persistAsync();
  return entry;
}

export function validateSyncToken(token: string): boolean {
  return syncTokens.has(token);
}

export function revokeSyncToken(token: string) {
  if (syncTokens.delete(token)) persistAsync();
}

export function listSyncTokens(): SyncToken[] {
  return [...syncTokens.values()];
}

// ── Export handler (stg side) ─────────────────────────────────────────────────

export async function handleDbExport(req: Request): Promise<Response> {
  const token = new URL(req.url).searchParams.get("token") || "";
  if (!validateSyncToken(token)) {
    return Response.json({ error: "Invalid sync token" }, { status: 401 });
  }

  // Fetch semua tabel yang relevan secara paralel
  const [
    usersRows,
    tokensRows,
    logsRows,
    dailyRows,
    upstreamRow,
    settingsRows,
  ] = await Promise.all([
    prisma.users.findMany(),
    prisma.tokens.findMany(),
    prisma.request_logs.findMany({ orderBy: { ts: "desc" }, take: 10_000 }),
    prisma.daily_usage.findMany(),
    prisma.upstream_state.findUnique({ where: { id: 1 } }),
    prisma.settings.findMany(),
  ]);

  // BigInt → string agar JSON-serializable
  const serialize = (obj: any): any => {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === "bigint") return obj.toString();
    if (Array.isArray(obj)) return obj.map(serialize);
    if (typeof obj === "object") {
      const out: any = {};
      for (const [k, v] of Object.entries(obj)) out[k] = serialize(v);
      return out;
    }
    return obj;
  };

  return Response.json({
    version:     1,
    exported_at: new Date().toISOString(),
    tables: {
      users:          serialize(usersRows),
      tokens:         serialize(tokensRows),
      request_logs:   serialize(logsRows),
      daily_usage:    serialize(dailyRows),
      upstream_state: upstreamRow ? serialize(upstreamRow) : null,
      settings:       serialize(settingsRows),
    },
  }, { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

// ── Sync handler (dev side) ───────────────────────────────────────────────────

interface SyncPayload {
  url:   string; // stg base URL, e.g. "https://claude-proxy.wibudev.com"
  token: string; // sync token dari stg
  tables?: string[]; // optional: subset tabel, default semua
}

const ALL_TABLES = ["users", "tokens", "request_logs", "daily_usage", "upstream_state", "settings"] as const;
type TableName = typeof ALL_TABLES[number];

export async function handleDbSync(req: Request): Promise<Response> {
  let body: SyncPayload;
  try {
    body = await req.json() as SyncPayload;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { url, token, tables: reqTables } = body;
  if (!url || !token) return Response.json({ error: "url and token are required" }, { status: 400 });

  const tablesToSync: TableName[] = reqTables
    ? (reqTables.filter(t => ALL_TABLES.includes(t as TableName)) as TableName[])
    : [...ALL_TABLES];

  // Ambil export dari stg
  let exportData: any;
  try {
    const exportUrl = new URL("/api/admin/db/export", url.replace(/\/$/, ""));
    exportUrl.searchParams.set("token", token);
    const res = await fetch(exportUrl.toString(), { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as any;
      return Response.json({ error: `Export failed: ${err.error || res.status}` }, { status: 502 });
    }
    exportData = await res.json();
  } catch (e: any) {
    return Response.json({ error: `Connection failed: ${e.message}` }, { status: 502 });
  }

  if (exportData.version !== 1) {
    return Response.json({ error: "Incompatible export version" }, { status: 400 });
  }

  const { tables } = exportData as { tables: Record<TableName, any[]> };
  const stats: Record<string, number> = {};

  // Fungsi konversi string → BigInt untuk kolom BigInt
  const toBigIntFields = (row: Record<string, any>, fields: string[]): Record<string, any> => {
    const out = { ...row };
    for (const f of fields) {
      if (out[f] !== null && out[f] !== undefined) out[f] = BigInt(out[f]);
    }
    return out;
  };

  // Sync tiap tabel dalam transaksi terpisah
  // (transaksi satu besar bisa timeout untuk request_logs banyak)
  for (const tbl of tablesToSync) {
    const rows = tables[tbl];
    if (!rows && tbl !== "upstream_state") { stats[tbl] = 0; continue; }

    if (tbl === "users") {
      await prisma.users.deleteMany({});
      if (rows.length) await prisma.users.createMany({ data: rows.map((r: any) => toBigIntFields(r, ["created_at"])) as any });
      stats[tbl] = rows.length;
    }

    else if (tbl === "tokens") {
      await prisma.tokens.deleteMany({});
      if (rows.length) await prisma.tokens.createMany({ data: rows.map((r: any) => toBigIntFields(r, ["lim", "win", "used", "window_start"])) as any });
      stats[tbl] = rows.length;
    }

    else if (tbl === "request_logs") {
      await prisma.request_logs.deleteMany({});
      let inserted = 0;
      const BATCH = 500;
      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH).map((r: any) => toBigIntFields(r, ["ts"]));
        await prisma.request_logs.createMany({ data: batch as any });
        inserted += batch.length;
      }
      stats[tbl] = inserted;
    }

    else if (tbl === "daily_usage") {
      await prisma.daily_usage.deleteMany({});
      if (rows.length) await prisma.daily_usage.createMany({ data: rows as any });
      stats[tbl] = rows.length;
    }

    else if (tbl === "upstream_state") {
      const row = tables.upstream_state;
      if (row) {
        const data = toBigIntFields(row, ["detected_window_ms", "last_poll"]) as any;
        await prisma.upstream_state.upsert({ where: { id: 1 }, create: data, update: data });
        stats[tbl] = 1;
      } else {
        stats[tbl] = 0;
      }
    }

    else if (tbl === "settings") {
      await prisma.settings.deleteMany({});
      if (rows.length) await prisma.settings.createMany({ data: rows as any });
      stats[tbl] = rows.length;
    }
  }

  // Reload runtime state dari DB baru
  await loadFromDb();
  await backfillUsers();

  return Response.json({
    ok:          true,
    synced_at:   new Date().toISOString(),
    source:      url,
    exported_at: exportData.exported_at,
    stats,
  });
}
