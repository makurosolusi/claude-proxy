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

// BigInt → string agar JSON-serializable. Module-level so both export +
// sync paths share the same helper.
function serialize(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "bigint") return obj.toString();
  if (Array.isArray(obj)) return obj.map(serialize);
  if (typeof obj === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(obj)) out[k] = serialize(v);
    return out;
  }
  return obj;
}

// ── Export handler (stg side) — NDJSON stream ─────────────────────────────────
// Streams one row per line as NDJSON. Memory bounded: large tables
// (request_logs) are paginated from DB in batches of 500. Reverse proxies
// flush as bytes arrive instead of waiting for the full response — eliminates
// the 502 / OOM that hit when this was a single Response.json() blob.
//
// Wire protocol (one JSON object per line, separated by \n):
//   {"type":"meta","version":2,"exported_at":"..."}
//   {"type":"row","table":"users","data":{...}}
//   {"type":"row","table":"users","data":{...}}
//   {"type":"table_end","table":"users","count":N}
//   ... per-table rows + table_end ...
//   {"type":"end"}
//
// Client must read line-by-line. See handleDbSync for the consumer.
export async function handleDbExport(req: Request): Promise<Response> {
  const token = new URL(req.url).searchParams.get("token") || "";
  if (!validateSyncToken(token)) {
    return Response.json({ error: "Invalid sync token" }, { status: 401 });
  }

  const enc = new TextEncoder();
  const REQUEST_LOGS_MAX = 10_000;
  const PAGE_SIZE        = 500;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const writeLine = (obj: unknown) => {
        controller.enqueue(enc.encode(JSON.stringify(obj) + "\n"));
      };

      try {
        writeLine({ type: "meta", version: 2, exported_at: new Date().toISOString() });

        // Small tables — fetch all at once, stream rows out
        const smallTables: Array<{ name: string; fetch: () => Promise<any[]> }> = [
          { name: "users",       fetch: () => prisma.users.findMany() },
          { name: "tokens",      fetch: () => prisma.tokens.findMany() },
          { name: "daily_usage", fetch: () => prisma.daily_usage.findMany() },
          { name: "settings",    fetch: () => prisma.settings.findMany() },
        ];

        for (const { name, fetch } of smallTables) {
          const rows = await fetch();
          for (const row of rows) writeLine({ type: "row", table: name, data: serialize(row) });
          writeLine({ type: "table_end", table: name, count: rows.length });
        }

        // upstream_state — single row
        const upRow = await prisma.upstream_state.findUnique({ where: { id: 1 } });
        if (upRow) writeLine({ type: "row", table: "upstream_state", data: serialize(upRow) });
        writeLine({ type: "table_end", table: "upstream_state", count: upRow ? 1 : 0 });

        // request_logs — paginated, memory-bounded. Cap at REQUEST_LOGS_MAX
        // to match historical behavior; raise this constant if needed.
        let cursor = 0;
        let totalLogs = 0;
        while (cursor < REQUEST_LOGS_MAX) {
          const batch = await prisma.request_logs.findMany({
            orderBy: { ts: "desc" },
            skip: cursor,
            take: Math.min(PAGE_SIZE, REQUEST_LOGS_MAX - cursor),
          });
          if (batch.length === 0) break;
          for (const row of batch) writeLine({ type: "row", table: "request_logs", data: serialize(row) });
          totalLogs += batch.length;
          cursor    += batch.length;
          if (batch.length < PAGE_SIZE) break;
        }
        writeLine({ type: "table_end", table: "request_logs", count: totalLogs });

        writeLine({ type: "end" });
        controller.close();
      } catch (e: any) {
        // Best-effort error line so client knows why stream ended early.
        try {
          writeLine({ type: "error", message: e?.message || "Unknown export error" });
        } catch {}
        try { controller.close(); } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type":      "application/x-ndjson",
      "Cache-Control":     "no-store",
      // Disable reverse-proxy buffering — critical so chunks reach the client
      // as soon as written, not pooled into a single big buffer.
      "X-Accel-Buffering": "no",
    },
  });
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
        // Modern path: NDJSON stream (one row per line, memory-bounded).
        // Legacy path: JSON blob (kept for cross-version compatibility while
        // older servers are still in the wild).
        emit("phase", { phase: "fetching_export", source: url });
        const tables: Record<string, any[]> = {};
        let exportedAt = "";
        let exportVersion = 0;

        try {
          const exportUrl = new URL("/api/admin/db/export", url.replace(/\/$/, ""));
          exportUrl.searchParams.set("token", token);
          // 5min ceiling for large exports — we no longer need to wait for the
          // whole blob, but the connection itself can take a while on slow
          // upstreams. AbortSignal also lets us cancel cleanly.
          const res = await fetch(exportUrl.toString(), { signal: AbortSignal.timeout(300_000) });
          if (!res.ok) {
            const err = await res.json().catch(() => ({})) as any;
            return emitError("export_fetch", `Export endpoint returned HTTP ${res.status}`, {
              http_status: res.status,
              remote_error: err.error || null,
            });
          }

          const contentType = res.headers.get("content-type") || "";
          const isNdjson    = contentType.includes("application/x-ndjson");

          if (isNdjson) {
            // ── NDJSON stream reader ─────────────────────────────────────
            const reader  = res.body!.getReader();
            const decoder = new TextDecoder();
            let buf       = "";
            let bytes     = 0;
            let rows      = 0;
            let lastEmit  = 0;
            let streamErr: string | null = null;

            const processLine = (line: string) => {
              if (!line.trim()) return;
              const obj = JSON.parse(line);
              if (obj.type === "meta") {
                exportVersion = obj.version || 0;
                exportedAt    = obj.exported_at || "";
              } else if (obj.type === "row") {
                (tables[obj.table] ||= []).push(obj.data);
                rows++;
              } else if (obj.type === "table_end") {
                // info only — used for progress UX in the future
              } else if (obj.type === "end") {
                // marker; loop will end when reader done
              } else if (obj.type === "error") {
                streamErr = obj.message || "Remote stream error";
              }
            };

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (cancelled) { reader.cancel().catch(() => {}); break; }

              bytes += value.length;
              buf   += decoder.decode(value, { stream: true });
              const lines = buf.split("\n");
              buf = lines.pop() ?? "";

              for (const line of lines) {
                try { processLine(line); }
                catch (e: any) {
                  return emitError("export_parse", `Failed to parse NDJSON line: ${e.message}`, {
                    line_preview: line.slice(0, 200),
                  });
                }
              }

              // Throttled progress event (every 250ms) so client UI shows
              // streaming activity without spamming WS.
              const now = Date.now();
              if (now - lastEmit > 250) {
                emit("phase", { phase: "downloading", bytes, rows });
                lastEmit = now;
              }
            }

            // Flush any tail bytes that didn't end with \n
            if (buf.trim()) {
              try { processLine(buf); } catch {}
            }

            if (streamErr) {
              return emitError("export_stream", `Remote stream error: ${streamErr}`, {});
            }

            emit("phase", { phase: "exported", size_bytes: bytes, rows });
          } else {
            // ── Legacy JSON blob path ────────────────────────────────────
            const raw = await res.text();
            emit("phase", { phase: "exported", size_bytes: raw.length });
            try {
              const exportData = JSON.parse(raw);
              if (exportData.version !== 1) {
                return emitError("export_parse", `Incompatible export version: expected 1, got ${exportData.version}`, {
                  received_version: exportData.version,
                });
              }
              exportVersion = exportData.version;
              exportedAt    = exportData.exported_at;
              for (const [k, v] of Object.entries(exportData.tables || {})) {
                if (Array.isArray(v)) tables[k] = v as any[];
                else if (v) tables[k] = [v]; // upstream_state historically a single object
              }
            } catch (e: any) {
              return emitError("export_parse", `Failed to parse export payload as JSON: ${e.message}`, {
                size_bytes: raw.length,
                preview: raw.slice(0, 200),
              });
            }
          }
        } catch (e: any) {
          return emitError("export_fetch", `Network error fetching export: ${e.message}`, {
            error_name: e.name,
          });
        }

        if (cancelled) { try { controller.close(); } catch {} return; }

        if (exportVersion !== 1 && exportVersion !== 2) {
          return emitError("export_parse", `Incompatible export version: ${exportVersion}`, {
            received_version: exportVersion,
          });
        }

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
              const row = Array.isArray(tables.upstream_state) ? tables.upstream_state[0] : null;
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
          exported_at: exportedAt,
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
