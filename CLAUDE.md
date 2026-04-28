# claude-proxy

Bun + TypeScript + React proxy untuk Claude Max OAuth → multi-user API key dengan quota management.

## Stack

- **Runtime**: Bun (TypeScript native), port via `--port` / `-p` flag atau `PORT` env
- **UI**: React 19 SPA + Mantine v9 + Tabler Icons — NO SSR
- **Styling**: Tailwind v4 (pre-built via `@tailwindcss/cli`)
- **Realtime**: Bun native WebSocket
- **Storage**: SQLite (`./state/proxy.db`) via `bun:sqlite`
- **Auth upstream**: OAuth token dari `CLIPROXY_AUTH_DIR/claude-*.json`
- **Auth admin**: Username/password → session cookie (SQLite-backed, 30-day TTL)

## Dev

```bash
bun run watch:css                          # Terminal 1 — CSS watcher
bun dev                                    # Terminal 2 — HMR :8080
dotenv -e .env.dev -- bun dev -p 8081     # Dev dengan env file + custom port
```

## Struktur Folder

```
src/
├── index.tsx        # Server entry (routes + WebSocket)
├── App.tsx          # React SPA (semua UI)
├── state.ts         # SQLite DB + prepared statements
├── tokens.ts        # Token CRUD, quota, in-flight reservation, generation counter
├── upstream.ts      # Poll upstream usage + backoff + OAuth refresh
├── broadcast.ts     # WS trigger
├── config.ts        # Env vars + port resolution
└── handlers/
    ├── proxy.ts     # Forward /v1/messages (cliproxy atau direct)
    ├── admin.ts     # Admin CRUD — returns JSON {ok:true}, bukan redirect
    ├── apiTest.ts   # GET /api/admin/test — connection test endpoint
    └── ...
docs/
├── ARCHITECTURE.md  # File structure, DB schema, endpoints, env vars
├── LOGIC.md         # Business logic detail
├── DEPLOY.md        # Scripts, infra
└── MIGRATION_DIRECT.md  # Rencana migrasi cliproxy → direct mode
```

## Konvensi Coding

- Tidak ada comment kecuali WHY non-obvious
- Validasi hanya di system boundary (user input, external API)
- Admin mutations: fetch() AJAX, bukan form POST — WebSocket push update UI
- Tidak ada feature flag atau backwards-compat shim
- Prefer edit file existing, bukan buat file baru

## Detail Lebih Lanjut

- @docs/ARCHITECTURE.md — file structure lengkap, DB schema, API endpoints, env vars
- @docs/LOGIC.md — quota system, upstream mode, token refresh, /mind graph
- @docs/DEPLOY.md — scripts, dev/prod commands, frpc tunnel setup
- @docs/MIGRATION_DIRECT.md — rencana + progress migrasi ke direct Anthropic API
