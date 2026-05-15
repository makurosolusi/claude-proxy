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

  // SSE stream — events emitted to the client as work progresses.
  // Event types: start, phase, table_start, table_progress, table_done, done, error
  //
  // Safety properties:
  //   B. Each table's delete+insert wrapped in a Prisma $transaction → atomic per table.
  //      Mid-table abort/crash rolls back fully; tables already done stay clean.
  //   C. req.signal AbortSignal monitored — after current table's TX commits,
  //      we check cancelled flag and skip remaining tables. The in-flight TX
  //      can't be cancelled mid-execution (Prisma limitation) but it WILL be
  //      atomic regardless.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // ── Disconnect detection (C) ─────────────────────────────────────
      let cancelled = false;
      const onAbort = () => {
        cancelled = true;
        console.log("[apiDbSync] Client disconnected — current TX will finish atomically, then stop");
      };
      req.signal?.addEventListener("abort", onAbort);

      const emit = (event: string, data: any) => {
        if (cancelled) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          cancelled = true;
        }
      };
      const emitError = (phase: string, message: string, extra: Record<string, any> = {}) => {
        emit("error", { phase, message, ...extra });
        try { controller.close(); } catch {}
      };

      try {
        emit("start", { source: url, tables: tablesToSync, started_at: new Date().toISOString() });

        // ── Fetch export from remote ─────────────────────────────────────
        emit("phase", { phase: "fetching_export", source: url });
        let exportData: any;
        try {
          const exportUrl = new URL("/api/admin/db/export", url.replace(/\/$/, ""));
          exportUrl.searchParams.set("token", token);
          const res = await fetch(exportUrl.toString(), { signal: AbortSignal.timeout(60_000) });
          if (!res.ok) {
            const err = await res.json().catch(() => ({})) as any;
            return emitError("export_fetch", `Export endpoint returned HTTP ${res.status}`, {
              http_status: res.status,
              remote_error: err.error || null,
            });
          }
          const raw = await res.text();
          emit("phase", { phase: "exported", size_bytes: raw.length });
          try {
            exportData = JSON.parse(raw);
          } catch (e: any) {
            return emitError("export_parse", `Failed to parse export payload as JSON: ${e.message}`, {
              size_bytes: raw.length,
              preview: raw.slice(0, 200),
            });
          }
        } catch (e: any) {
          return emitError("export_fetch", `Network error fetching export: ${e.message}`, {
            error_name: e.name,
          });
        }

        if (cancelled) { try { controller.close(); } catch {} return; }

        if (exportData.version !== 1) {
          return emitError("export_parse", `Incompatible export version: expected 1, got ${exportData.version}`, {
            received_version: exportData.version,
          });
        }

        const { tables } = exportData as { tables: Record<TableName, any[]> };
        const stats: Record<string, number> = {};

        const toBigIntFields = (row: Record<string, any>, fields: string[]): Record<string, any> => {
          const out = { ...row };
          for (const f of fields) {
            if (out[f] !== null && out[f] !== undefined) out[f] = BigInt(out[f]);
          }
          return out;
        };

        // ── Sync each table sequentially (B: atomic per table) ──────────
        for (const tbl of tablesToSync) {
          if (cancelled) { console.log(`[apiDbSync] Aborted before "${tbl}" — stopping`); break; }

          const rows = tables[tbl];
          const expected = Array.isArray(rows) ? rows.length : (rows ? 1 : 0);
          emit("table_start", { table: tbl, expected });

          try {
            if (!rows && tbl !== "upstream_state") {
              stats[tbl] = 0;
            } else if (tbl === "users") {
              await prisma.$transaction(async (tx) => {
                await tx.users.deleteMany({});
                if (rows.length) await tx.users.createMany({ data: rows.map((r: any) => toBigIntFields(r, ["created_at"])) as any });
              }, { timeout: 30_000 });
              stats[tbl] = rows.length;
            } else if (tbl === "tokens") {
              await prisma.$transaction(async (tx) => {
                await tx.tokens.deleteMany({});
                if (rows.length) await tx.tokens.createMany({ data: rows.map((r: any) => toBigIntFields(r, ["lim", "win", "used", "window_start"])) as any });
              }, { timeout: 30_000 });
              stats[tbl] = rows.length;
            } else if (tbl === "request_logs") {
              // Wrap entire delete + all batches in one tx — atomic. Longer timeout
              // for the potentially-large dataset (default 5s would fail at ~5k rows).
              await prisma.$transaction(async (tx) => {
                await tx.request_logs.deleteMany({});
                const BATCH = 500;
                let inserted = 0;
                for (let i = 0; i < rows.length; i += BATCH) {
                  const batch = rows.slice(i, i + BATCH).map((r: any) => toBigIntFields(r, ["ts"]));
                  await tx.request_logs.createMany({ data: batch as any });
                  inserted += batch.length;
                  emit("table_progress", { table: tbl, inserted, expected });
                }
              }, { timeout: 120_000 });
              stats[tbl] = rows.length;
            } else if (tbl === "daily_usage") {
              await prisma.$transaction(async (tx) => {
                await tx.daily_usage.deleteMany({});
                if (rows.length) await tx.daily_usage.createMany({ data: rows as any });
              }, { timeout: 30_000 });
              stats[tbl] = rows.length;
            } else if (tbl === "upstream_state") {
              const row = tables.upstream_state as any;
              if (row) {
                const data = toBigIntFields(row, ["detected_window_ms", "last_poll"]) as any;
                await prisma.upstream_state.upsert({ where: { id: 1 }, create: data, update: data });
                stats[tbl] = 1;
              } else {
                stats[tbl] = 0;
              }
            } else if (tbl === "settings") {
              await prisma.$transaction(async (tx) => {
                await tx.settings.deleteMany({});
                if (rows.length) await tx.settings.createMany({ data: rows as any });
              }, { timeout: 30_000 });
              stats[tbl] = rows.length;
            }
            emit("table_done", { table: tbl, count: stats[tbl] });
          } catch (e: any) {
            return emitError("table_write", `Failed writing table "${tbl}": ${e.message}`, {
              table: tbl,
              prisma_code: e.code || null,
              prisma_meta: e.meta || null,
            });
          }
        }

        if (cancelled) {
          console.log("[apiDbSync] Stopped after client disconnect; partial sync up to current table");
          try { controller.close(); } catch {}
          return;
        }

        // ── Reload runtime state ─────────────────────────────────────────
        emit("phase", { phase: "reloading_state" });
        try {
          await loadFromDb();
          await backfillUsers();
        } catch (e: any) {
          return emitError("state_reload", `DB written but state reload failed: ${e.message}`, {});
        }

        emit("done", {
          ok:          true,
          synced_at:   new Date().toISOString(),
          source:      url,
          exported_at: exportData.exported_at,
          stats,
        });
        try { controller.close(); } catch {}
      } catch (e: any) {
        emitError("unexpected", e.message || "Unknown error", { stack: e.stack?.slice(0, 500) });
      } finally {
        req.signal?.removeEventListener("abort", onAbort);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
