# Architecture

## File Structure

```
src/
├── index.tsx         # Server entry: Bun.serve() routes API + WebSocket
├── index.html        # HTML template (React SPA entry)
├── frontend.tsx      # React client entry (createRoot + HMR)
├── App.tsx           # React SPA — semua UI components
├── index.css         # Tailwind v4 source (input ke build:css)
├── style.css         # Tailwind output (generated, di-link dari index.html)
├── broadcast.ts      # WS broadcast trigger (shared, hindari circular import)
├── config.ts         # Env vars (typed const)
├── types.ts          # Shared interfaces
├── state.ts          # SQLite DB, prepared statements, runtime state
├── tokens.ts         # Token CRUD, daily usage, checkReset
├── upstream.ts       # Poll /api/oauth/usage, backoff, window rotation
└── handlers/
    ├── apiStatus.ts  # GET /api/status (JSON)
    ├── apiLogs.ts    # GET /api/logs (paginated + detail)
    ├── apiStats.ts   # GET /api/stats (analytics aggregation)
    ├── apiMind.ts    # GET /api/mind (mind map graph data)
    ├── proxy.ts      # Forward POST /v1/messages ke upstream
    └── admin.ts      # Admin CRUD endpoints
public/
└── client.js         # Upstream section updater
```

## Database Schema (SQLite — `./state/proxy.db`)

| Tabel | Kolom penting |
|---|---|
| `tokens` | key, lim, win, used, window_start, paused, dynamic, deleted (soft delete) |
| `upstream_state` | single row, semua poll data |
| `daily_usage` | (date, token_key, used) — prune otomatis 30 hari |
| `request_logs` | ts, token_key, model, input/output/cache tokens, stream, status, stop_reason, tool_use_count, duration_ms, turns, prompt (2000 char), system_prompt (500 char) |
| `admin_sessions` | session token, created_at, last_used (30-day TTL) |

## API Endpoints

| Method | Path | Auth | Keterangan |
|---|---|---|---|
| GET | `/*` | — | React SPA (semua non-API routes) |
| GET | `/ws` | cookie | WebSocket — real-time status push |
| GET/POST | `/admin/login` | — | Login form |
| GET | `/admin/logout` | cookie | Logout |
| GET | `/api/status` | optional | JSON status (tokens + upstream + isAdmin) |
| GET | `/api/logs` | — | Paginated request logs (`?page&limit&user`) |
| GET | `/api/logs/:id` | — | Single log detail |
| GET | `/api/stats` | admin | Analytics aggregation |
| GET | `/api/mind` | — | Mind map graph data (User→Date→Hour→Request) |
| POST | `/admin/reset` | admin | Reset pemakaian token |
| POST | `/admin/token/add` | admin | Tambah token dinamis |
| POST | `/admin/token/edit` | admin | Edit limit token |
| POST | `/admin/token/edit-all` | admin | Edit limit semua token |
| POST | `/admin/token/pause` | admin | Pause/resume token |
| POST | `/admin/token/delete` | admin | Hapus token |
| POST | `/admin/logs/clear` | admin | Hapus request logs |
| GET | `/v1/models` | user token | List model |
| GET | `/v1/usage` | user token | Usage info token |
| POST | `/v1/messages` | user token | Proxy ke upstream |
| POST | `/v1/messages/count_tokens` | user token | Stub (return 0) |

## Env Vars

| Var | Default | Keterangan |
|---|---|---|
| `UPSTREAM` | — | URL upstream Anthropic-compatible API |
| `UPSTREAM_KEY` | — | API key untuk upstream |
| `ADMIN_KEY` | — | API key untuk programmatic admin access (`x-admin-key` header) |
| `ADMIN_USERNAME` | — | Username login form admin |
| `ADMIN_PASSWORD` | — | Password login form admin |
| `TOKENS` | — | Newline-separated `key:limit` atau `key:limit:windowMs` |
| `WINDOW_MS` | `18000000` | Default window per token (ms) |
| `UPSTREAM_HARD_CAP_PCT` | `95` | Block request kalau 5-hour utilization >= nilai ini |
| `UPSTREAM_POLL_MS` | `60000` | Interval poll usage upstream (ms) |
| `CLIPROXY_AUTH_DIR` | `/cliproxy-auth` | Dir berisi `claude-*.json` OAuth credentials |
| `DB_FILE` | `./state/proxy.db` | Path SQLite database |
| `PORT` | `8080` | HTTP port |
