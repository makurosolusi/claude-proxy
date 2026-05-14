# Architecture

## File Structure

```
src/
├── serve.ts          # Dev entry: PID takeover → dynamic import index.tsx (cegah EADDRINUSE)
├── index.tsx         # Server entry: Bun.serve() routes API + WebSocket + Vite middleware
├── index.html        # HTML template + inline FOUC-prevention script
├── frontend.tsx      # React client entry (createRoot + Vite HMR)
├── App.tsx           # React SPA — semua UI components (Dashboard, AdminDashboard, MindPage)
├── DevInspector.tsx  # Click-to-source inspector (dev only, tree-shaken di prod)
├── inspector-plugin.ts  # Vite plugin: inject data-inspector-* attrs ke JSX (enforce: pre)
├── broadcast.ts      # WS broadcast trigger
├── config.ts         # Env vars + resolvePort() (CLI flag > env > default)
├── types.ts          # Shared interfaces (TokenEntry, UpstreamState, etc.)
├── contexts.ts       # Frontend-shared types (TokenStatus, ProfileToken, etc.)
├── state.ts          # PostgreSQL runtime state, settings cache, in-flight reservation
├── tokens.ts         # Token CRUD, incrementUsage, in-flight reservation system
├── upstream.ts       # Poll /api/oauth/usage, backoff, token refresh, window rotation
├── customProviders.ts # Custom provider type, validation, getCustomProvider/listCustomProviders
├── openaiTranslate.ts # OpenAI ↔ Anthropic translation (request body + SSE stream)
├── providerDisplay.ts # Shared frontend helper: resolveProvider, shortenModel
├── auth.ts           # Better Auth instance (Google OAuth)
└── handlers/
    ├── apiStatus.ts          # GET /api/status (JSON, includes effective routing)
    ├── apiLogs.ts            # GET /api/logs (paginated + detail)
    ├── apiStats.ts           # GET /api/stats (analytics aggregation)
    ├── apiMind.ts            # GET /api/mind (User→Date→Hour→Request graph data)
    ├── apiTest.ts            # GET /api/admin/test (connection test)
    ├── apiAuth.ts            # OAuth PKCE + paste-JSON credential import
    ├── apiCustomProviders.ts # CRUD /api/admin/custom-providers
    ├── apiModels.ts          # GET /v1/models, /api/admin/models/:id (provider-aware)
    ├── proxy.ts              # Forward POST /v1/messages (cliproxy/direct/custom)
    └── admin.ts              # Admin CRUD — all mutations return JSON {ok:true}
vite.config.ts        # Vite: middlewareMode=true, inspectorPlugin + react, hmr port 24678
public/
└── client.js         # Upstream section updater
docs/
├── ARCHITECTURE.md
├── LOGIC.md
├── DEPLOY.md
└── MIGRATION_DIRECT.md
```

## Database Schema (PostgreSQL via Prisma — see `prisma/schema.prisma`)

| Tabel | Kolom penting |
|---|---|
| `tokens` | key, lim, win, used, window_start, paused, dynamic, deleted, **provider** (inherit/anthropic/deepseek/openrouter/custom-slug), **mode** (inherit/direct/cliproxy), **label**, **description**, **pinned_model**, **user_id** (FK) |
| `users` | id, email, role (USER/ADMIN/SUPER_ADMIN), status (PENDING/APPROVED/REJECTED) — Better Auth synced |
| `user`, `session`, `account` | Better Auth tables (Google OAuth) |
| `settings` | key/value — `provider_override`, `poll_interval_ms`, `custom_providers` (JSON), `deepseek_*`, `openrouter_*`, `demo_mode` |
| `upstream_state` | single row, semua poll data |
| `daily_usage` | (date, token_key, used) — prune otomatis 30 hari |
| `request_logs` | ts, token_key, model, input/output/cache tokens, stream, status, stop_reason, tool_use_count, duration_ms, turns, prompt (2000 char), system_prompt (500 char) |
| `admin_sessions` | session token, created_at, last_used (30-day TTL) — fallback admin auth (selain Better Auth session) |

## API Endpoints

| Method | Path | Auth | Keterangan |
|---|---|---|---|
| GET | `/*` | — | React SPA |
| GET | `/ws` | cookie | WebSocket — real-time status push |
| GET/POST | `/admin/login` | — | Login form (server-rendered HTML) |
| GET | `/admin/logout` | cookie | Logout |
| GET | `/api/status` | optional | JSON status (tokens + upstream + isAdmin) |
| GET | `/api/logs` | — | Paginated request logs (`?page&limit&user`) |
| GET | `/api/logs/:id` | — | Single log detail |
| GET | `/api/stats` | admin | Analytics aggregation |
| GET | `/api/mind` | — | Mind map graph (User→Date→Hour→Request) |
| GET | `/api/admin/test` | admin | Connection test (credential, usage API, messages API) |
| GET | `/api/admin/credentials` | admin | List OAuth credential files (`claude-*.json`) |
| POST | `/api/admin/credentials/remove` | admin | Disable credential file (`{ file }`) |
| GET | `/admin/auth/login` | admin | Mulai OAuth PKCE flow → redirect ke claude.ai |
| POST | `/admin/reset` | admin | Reset usage token |
| POST | `/admin/token/add` | admin | Tambah token |
| POST | `/admin/token/edit` | admin | Edit limit |
| POST | `/admin/token/edit-all` | admin | Edit semua limit |
| POST | `/admin/token/pause` | admin | Pause/resume |
| POST | `/admin/token/delete` | admin | Hapus (soft delete) |
| POST | `/admin/token/meta` | admin | Edit label + description (`{ key, label, description }`) |
| POST | `/admin/token/pin-model` | admin | Set/clear pinned_model per token (`{ key, model }`, `""` = clear) |
| POST | `/admin/token/pin-all` | admin | Bulk pin (`{ model, user_id?, provider_scope? }`) → `{ ok, count }` |
| POST | `/admin/token/mode` | admin | Set per-token mode (inherit/direct/cliproxy) |
| POST | `/admin/token/provider` | admin | Set per-token provider override |
| POST | `/admin/settings/provider-override` | admin | Set global routing target (`{ value }`) |
| POST | `/admin/settings/poll-interval` | admin | Set upstream poll interval ms |
| POST | `/admin/settings/provider-model` | admin | Set default model per provider (DS/OR) |
| GET | `/api/admin/custom-providers` | admin | List custom providers (api_key masked) |
| POST | `/api/admin/custom-providers` | admin | Create/update custom provider |
| DELETE | `/api/admin/custom-providers/:id` | admin | Hapus custom provider |
| GET | `/api/admin/models/:id` | admin | Fetch `/v1/models` dari provider (30 min cache) |
| GET | `/api/admin/test/:id` | admin | Connection test per provider (auto-pick model) |
| POST | `/admin/auth/import` | admin | Paste-JSON credential import (no PKCE flow) |
| POST | `/admin/logs/clear` | admin | Hapus request logs |
| GET | `/api/profile` | session | Current user profile + tokens (with `effective_provider`, `pinned_model`) + `custom_providers` |
| GET | `/v1/models` | user token | List model |
| GET | `/v1/usage` | user token | Usage info token |
| POST | `/v1/messages` | user token | Proxy ke upstream |
| POST | `/v1/messages/count_tokens` | user token | Stub (return 0) |

Auth: `x-api-key` header **atau** `Authorization: Bearer <token>`.  
Admin mutations semua return `{ ok: true }` — tidak ada page reload.

## Env Vars

| Var | Default | Keterangan |
|---|---|---|
| `ANTHROPIC_API_URL` | `https://api.anthropic.com` | Override URL Anthropic API |
| `ADMIN_KEY` | — | `x-admin-key` header untuk programmatic access |
| `TOKENS` | — | Newline-separated `key:limit` atau `key:limit:windowMs` |
| `WINDOW_MS` | `18000000` | Default window per token (ms) |
| `UPSTREAM_HARD_CAP_PCT` | `95` | Block request kalau 5-hour utilization >= nilai ini |
| `UPSTREAM_POLL_MS` | `60000` | Interval poll usage upstream (ms) |
| `CLIPROXY_AUTH_DIR` | `/cliproxy-auth` | Dir berisi `claude-*.json` OAuth credentials |
| `DATABASE_URL` | — | PostgreSQL connection string (Prisma) |
| `PORT` | `8080` | HTTP port (dapat di-override via `--port` / `-p` CLI flag) |
| `REACT_EDITOR` | `code` | Editor untuk click-to-source: `cursor`, `code`, `zed`, `subl` |
