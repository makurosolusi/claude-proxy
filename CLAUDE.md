# claude-proxy

Bun + TypeScript + React proxy untuk Claude Max OAuth → multi-user API key dengan quota management.

## Stack

- **Runtime**: Bun (TypeScript native)
- **UI**: React 19 SPA — NO SSR, NO renderToString
- **Styling**: Tailwind v4 (pre-built via `@tailwindcss/cli`)
- **Realtime**: Bun native WebSocket
- **Storage**: SQLite (`./state/proxy.db`) via `bun:sqlite`
- **Auth upstream**: OAuth token dari `CLIPROXY_AUTH_DIR/claude-*.json`
- **Auth admin**: Username/password → session cookie (SQLite-backed, 30-day TTL)

## Dev

```bash
bun run watch:css   # Terminal 1 — CSS watcher
bun dev             # Terminal 2 — HMR server on :8080
```

## Struktur Folder

```
src/
├── index.tsx      # Server entry (routes + WebSocket)
├── App.tsx        # React SPA (semua UI)
├── state.ts       # SQLite DB + prepared statements
├── tokens.ts      # Token CRUD + usage
├── upstream.ts    # Poll upstream usage + backoff
├── broadcast.ts   # WS trigger (hindari circular import)
├── config.ts      # Env vars
└── handlers/      # Per-route handlers
public/
└── client.js      # Upstream section updater
```

## Konvensi Coding

- Tidak ada comment kecuali WHY non-obvious
- Tidak ada error handling untuk case yang tidak mungkin terjadi
- Validasi hanya di system boundary (user input, external API)
- Tidak ada feature flag atau backwards-compat shim
- Prefer edit file existing, bukan buat file baru

## Detail Lebih Lanjut

- @docs/ARCHITECTURE.md — file structure lengkap, DB schema, API endpoints, env vars
- @docs/LOGIC.md — business logic: window rotation, soft cap, backoff, auth, /mind graph
- @docs/DEPLOY.md — scripts, dev/prod commands, frpc tunnel setup
