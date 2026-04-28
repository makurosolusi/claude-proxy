# Business Logic

## Window Rotation Detection
Bandingkan `resets_at` dari upstream dengan threshold **> 30 menit** — Anthropic return microsecond berbeda tiap poll untuk window yang sama, sehingga threshold ini menghindari false positive rotation.

## Soft Cap
Kalau upstream 5-hour utilization ≥ `UPSTREAM_HARD_CAP_PCT`, semua request diblok dengan `429` + `retry-after`. Default cap: 95%.

## Poll Backoff
HTTP 429 dari usage endpoint → backoff minimum 5 menit. Skip poll selama backoff aktif. State disimpan di `upstream_state`.

## Usage Persistence
`incrementUsage()` → `dbUpdateUsage()` + `dbUpsertDailyUsage()` — synchronous SQLite write, WAL mode. Setiap request mencatat token ke window saat ini dan tabel `daily_usage`.

## WebSocket Realtime
`triggerBroadcast()` dipanggil dari: upstream poll sukses, setiap admin mutation. Server push ke semua connected WS clients via Bun native WebSocket. Client auto-reconnect setiap 3 detik.

## Request Log Extraction
Prompt diambil dari **LAST user message** yang punya text content (skip tool_result turns). System injections (`<system-reminder>`, `<local-command-caveat>`, dll) di-strip sebelum disimpan ke `request_logs.prompt`.

## Admin Auth
Login via form → `admin_session` cookie (HttpOnly, SameSite=Lax). Session disimpan di SQLite tabel `admin_sessions`, survive server restart. `x-admin-key` header juga work untuk programmatic access.

## Upstream Mode (Direct vs Cliproxy)

`UPSTREAM_MODE` menentukan bagaimana `/v1/messages` di-forward:

- **`cliproxy`** (default): forward ke `UPSTREAM` pakai `UPSTREAM_KEY` — tidak ada perubahan dari sebelumnya
- **`direct`**: forward langsung ke `ANTHROPIC_API_URL` pakai OAuth `access_token` dari `claude-*.json`

Per-token override via kolom `mode` di tabel `tokens` (`inherit`/`direct`/`cliproxy`). Efektif mode = token.mode jika bukan `inherit`, else global `UPSTREAM_MODE`. Admin endpoint: `POST /admin/token/mode`.

**Token Refresh (direct mode):** Access token TTL 8 jam. Saat 401, `refreshOauthToken()` dipanggil otomatis — hit `https://console.anthropic.com/v1/oauth/token` dengan `client_id: 9d1c250a-e61b-44d9-88ed-5944d1962f5e`. Refresh token **rotate** (single-use) — file credential diupdate langsung setelah refresh. Mutex `isRefreshing` mencegah double-refresh dari concurrent requests.

**Shadow Mode:** `SHADOW_DIRECT=true` — saat mode cliproxy, kirim request paralel ke direct (fire-and-forget), log perbedaan status/token. Digunakan untuk validasi sebelum full cutover.

## /mind Graph (User → Date → Hour → Request)
`GET /api/mind` mengambil semua `request_logs` (max 2000), di-group menjadi 4 tier:
- **Category 0** User root node — ukuran √(requests/maxUser)
- **Category 1** Date node (YYYY-MM-DD) — per user per tanggal
- **Category 2** Hour node (HH:00) — per user per tanggal per jam
- **Category 3** Request leaf — tiap baris `request_logs`, ukuran √(tokens/maxTok)

Link types: `ud` (user→date), `dh` (date→hour), `hr` (hour→request).
