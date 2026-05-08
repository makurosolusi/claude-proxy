# claude-proxy

Bun + TypeScript + React proxy untuk Claude Max OAuth → multi-user API key dengan quota management.

## Stack

- **Runtime**: Bun (TypeScript native), port via `PORT` env atau `--port` flag
- **UI**: React 19 SPA + Mantine v9 + Tabler Icons — NO SSR
- **Frontend bundler**: Vite (middleware mode, single port) + React Router DOM v7
- **Realtime**: Bun native WebSocket
- **Storage**: SQLite (`./state/proxy.db`) via `bun:sqlite`
- **Auth upstream**: OAuth token dari `CLIPROXY_AUTH_DIR/claude-*.json`
- **Auth admin**: Username/password → session cookie (SQLite-backed, 30-day TTL)

## Dev

```bash
bun dev          # bun --hot src/serve.ts → :8080 (Vite middleware + Bun API, single port)
bun run build    # vite build → dist/
bun start        # NODE_ENV=production bun src/index.tsx
```

Set `REACT_EDITOR=cursor` (atau `code`, `zed`) di `.env` untuk click-to-source (`Ctrl+Shift+Cmd+C`).

## Konvensi Coding

- Tidak ada comment kecuali WHY non-obvious
- Validasi hanya di system boundary (user input, external API)
- Admin mutations: `fetch()` AJAX, bukan form POST — WebSocket push update UI
- Tidak ada feature flag atau backwards-compat shim
- Prefer edit file existing, bukan buat file baru

## Aturan Deploy

- **Jangan deploy (`mcp__deploy-stg__deploy`) sebelum ada perintah eksplisit dari user.**
- Setelah code selesai dan siap, cukup lapor ke user — tunggu instruksi deploy.

## Referensi

- @AI-CONTRACT.md — aturan kerja AI: prinsip, checklist sebelum edit, larangan, eskalasi
- @docs/ARCHITECTURE.md — file structure, DB schema, API endpoints, env vars
- @docs/LOGIC.md — quota system, upstream mode, token refresh, /mind graph
- @docs/DEPLOY.md — scripts, infra, Docker, Traefik
