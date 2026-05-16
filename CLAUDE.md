# claude-proxy

Bun + TypeScript + React proxy untuk Claude Max OAuth → multi-user API key dengan quota management.

## Stack

- **Runtime**: Bun (TypeScript native), port via `PORT` env atau `--port` flag
- **UI**: React 19 SPA + Mantine v9 + Tabler Icons — NO SSR
- **Frontend bundler**: Vite (middleware mode, single port) + React Router DOM v7
- **Realtime**: Bun native WebSocket
- **Storage**: PostgreSQL via Prisma ORM (`prisma/schema.prisma`)
- **Auth user**: Google OAuth → Better Auth (`src/auth.ts`) — session cookie, tabel `user`/`session`/`account`
- **Auth admin**: `x-admin-key` header atau Better Auth session dengan role `SUPER_ADMIN`/`ADMIN`
- **Auth upstream**: OAuth token dari `CLIPROXY_AUTH_DIR/claude-*.json`

## Dev

```bash
bun dev          # bun --hot src/serve.ts → PORT (default :3000, Vite middleware + Bun API, single port)
bun run build    # vite build → dist/
bun start        # NODE_ENV=production bun src/index.tsx
```

Set `REACT_EDITOR=cursor` (atau `code`, `zed`) di `.env` untuk click-to-source (`Ctrl+Shift+Cmd+C`).

## MCP Debug

- `debug-dev` → `scripts/mcp/debug-dev.ts` — debug local dev (localhost:PORT), auth via `MCP_SECRET`
- `debug-stg` → `scripts/mcp/debug-stg.ts` — debug staging, auth via `MCP_SECRET`
- Endpoint debug: `/api/debug/query` (SQL), `/api/debug/token/*`, `/api/debug/quota-pressure`, `/api/debug/upstream-history`
- Auth debug endpoint pakai `x-mcp-secret` header, **bukan** `x-admin-key`

## Konvensi Coding

- Tidak ada comment kecuali WHY non-obvious
- Validasi hanya di system boundary (user input, external API)
- Admin mutations: `fetch()` AJAX, bukan form POST — WebSocket push update UI
- Tidak ada feature flag atau backwards-compat shim
- Prefer edit file existing, bukan buat file baru

## Auth Notes

- `checkUser(req)` — validasi via Better Auth session cookie, lookup email ke tabel `users` app
- `checkAdmin(req)` — cek `x-admin-key` header atau session dengan role `SUPER_ADMIN`/`ADMIN`
- Endpoint publik (accessible semua user login): `/api/sessions/*`, `/api/sessions/summary`, `/api/competition`, `/api/admin/user-activity`
- Fetch dari React ke endpoint yang butuh session **wajib** pakai `{ credentials: "include" }`

## Provider Posture (Anthropic optional)

- Aplikasi tetap berjalan tanpa credential Claude — lihat `docs/LOGIC.md` section "Operation Mode".
- Default provider chain: anthropic (jika ada) → openrouter → deepseek → first custom. Lihat `src/providerSelection.ts`.
- Kalau menambah handler baru yang menyentuh Anthropic, **wajib** guard dengan `hasAnthropicCredential()` dari `src/upstream.ts` — jangan asumsikan cred ada.

## Aturan Deploy

- **Jangan deploy (`mcp__deploy-stg__deploy`) sebelum ada perintah eksplisit dari user.**
- Setelah code selesai dan siap, cukup lapor ke user — tunggu instruksi deploy.

## Referensi

- @AI-CONTRACT.md — aturan kerja AI: prinsip, checklist sebelum edit, larangan, eskalasi
- @docs/ARCHITECTURE.md — file structure, DB schema, API endpoints, env vars
- @docs/LOGIC.md — quota system, upstream mode, token refresh, /mind graph
- @docs/DEPLOY.md — scripts, infra, Docker, Traefik
- @docs/FILE-HEALTH.md — aturan ukuran & struktur file (batas baris/karakter, pisah file)
