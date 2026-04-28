# Business Logic

## Quota System (In-Flight Reservation)

Setiap request ke `/v1/messages` melalui pipeline berikut:

1. **Quota check**: `t.used + getInFlight(key) >= t.limit` → 429
2. **Reserve**: `reserveInFlight(key, estimatedTokens)` → unique `reservationId`
3. **Forward** ke upstream (cliproxy atau direct)
4. **Track usage**: `incrementUsage(key, actualTokens, reqGen)` saat token response tiba
5. **Release**: `releaseInFlight(key, reservationId)` — dijamin via `try-finally` + TTL

**In-flight reservation design:**
- Setiap reservation punya **unique numeric ID** — release exact, tidak ambigu
- **TTL 10 menit** auto-expire reservation yang bocor (disconnect, exception)
- `try-catch` wraps seluruh forward block — `catch` selalu release sebelum return 502
- Streaming: release di `finally` inner async block
- Non-streaming: release sebelum return response

**Token estimation** (input bisa 100k+ chars di Claude Code):
```
estimatedTokens = ceil(messageChars / 3.5) + 300 + maxOutputTokens
```

**Generation counter** (anti post-reset inflation):
- `reqGen = getGeneration(key)` di-snapshot saat request mulai
- Admin reset: `bumpGeneration(key)` + `clearInFlight(key)`
- `incrementUsage(key, delta, gen)` — ignore jika `gen !== currentGeneration`
- Mencegah request yang sudah berjalan sebelum reset untuk inflate counter setelah reset

## Window Rotation Detection
Bandingkan `resets_at` dari upstream dengan threshold **> 30 menit**. Saat rotasi terdeteksi, semua `t.used = 0` dan `t.windowStart` di-align ke window baru.

**Stale display**: Jika `resets_at` sudah lewat tapi poll belum berhasil, tampilkan ring sebagai 0%/gray ("waiting for poll") bukan data stale.

## Soft Cap
Kalau upstream 5-hour utilization ≥ `UPSTREAM_HARD_CAP_PCT`, semua request diblok dengan `429` + `retry-after`.

## Poll Backoff
HTTP 429 dari usage endpoint → backoff minimum 5 menit. Saat 401 pada poll → auto-refresh OAuth token dan retry.

## Usage Persistence
`incrementUsage(key, delta, gen)` — synchronous SQLite write (WAL mode). Daily usage dicatat di `daily_usage`, current window di `tokens.used`.

## WebSocket Realtime
`triggerBroadcast()` dari: upstream poll sukses, setiap admin mutation (semua admin handlers return JSON `{ok:true}` dan memanggil `triggerBroadcast()`). Client auto-reconnect 3s.

## Request Log Extraction
Prompt = LAST user message dengan text content. System injections (`<system-reminder>`, dll) di-strip. Disimpan ke `request_logs.prompt` (max 2000 char).

## Admin Auth
Login → `admin_session` cookie (HttpOnly, SameSite=Lax, SQLite-backed). `x-admin-key` header untuk programmatic. `/admin/login` server-rendered HTML (bukan React route) — `RequireAdmin` pakai `window.location.replace()` bukan React Router Navigate.

## OAuth PKCE Login (Self-Contained Credential Setup)

Admin bisa connect Claude account langsung dari admin panel tanpa Claude Code CLI:

1. **`GET /admin/auth/login`** (admin required):
   - Generate `code_verifier` (32 random bytes, base64url) + `code_challenge` (S256)
   - Simpan `{ codeVerifier, ts }` di in-memory Map dengan key = random `state` UUID
   - Start temporary Bun server di port **54545** (redirect_uri yang terdaftar di OAuth app)
   - Return 302 → `https://claude.ai/oauth/authorize?...`

2. **Callback di port 54545**:
   - Terima `?code=&state=` dari claude.ai redirect
   - Validasi `state` vs in-memory Map, cek TTL 10 menit
   - Exchange code ke token via `POST https://api.anthropic.com/v1/oauth/token`
   - Resolve email: JWT decode → profile endpoint → timestamp fallback
   - Simpan `CLIPROXY_AUTH_DIR/claude-{email}.json`
   - Bust `upstream.tokenCache` agar next request pakai credential baru
   - Shutdown server setelah callback ditangani

**Kenapa port 54545**: OAuth client_id `9d1c250a-e61b-44d9-88ed-5944d1962f5e` (public, dari Claude Code CLI) terdaftar dengan redirect_uri `http://localhost:54545/callback` — tidak bisa diganti.

**Credential file format** (`claude-{email}.json`):
```json
{ "access_token": "sk-ant-oat01-...", "refresh_token": "sk-ant-ort01-...",
  "email": "user@gmail.com", "disabled": false, "created_at": "...", "updated_at": "..." }
```

## Upstream Mode (Direct vs Cliproxy)

`UPSTREAM_MODE` menentukan forward `/v1/messages`:
- **`cliproxy`** (default): → `UPSTREAM` + `UPSTREAM_KEY`
- **`direct`**: → `ANTHROPIC_API_URL` + OAuth `access_token` dari `claude-*.json`

Per-token override: `tokens.mode` (`inherit`/`direct`/`cliproxy`). Admin endpoint: `POST /admin/token/mode`.

**Direct mode specifics:**
- Strip `context_management` field (Claude Code CLI specific, Anthropic API tolak)
- 401 → auto `refreshOauthToken()` → retry sekali
- Refresh endpoint: `https://console.anthropic.com/v1/oauth/token`, client_id: `9d1c250a-e61b-44d9-88ed-5944d1962f5e`
- Refresh token **rotate** (single-use) — file credential diupdate langsung
- Mutex `isRefreshing` mencegah double-refresh dari concurrent requests

**Shadow Mode:** `SHADOW_DIRECT=true` — paralel fire-and-forget ke direct, log diff. Tidak mempengaruhi response ke user.

## /mind Graph (User → Date → Hour → Request)
`GET /api/mind` group `request_logs` (max 2000) menjadi 4 tier:
- **Cat 0** User — ukuran √(requests/maxUser)
- **Cat 1** Date (YYYY-MM-DD)
- **Cat 2** Hour (HH:00)
- **Cat 3** Request leaf — ukuran √(tokens/maxTok)

Link types: `ud` (user→date), `dh` (date→hour), `hr` (hour→request).

## FOUC Prevention
`index.html` punya inline script yang set `data-mantine-color-scheme` + `background-color` sebelum CSS/JS load, berdasarkan `localStorage("mantine-color-scheme-value")` atau `prefers-color-scheme`.

## Dynamic Background (Public Page `/`)
Background public page shift ke gradient dark red sesuai upstream 5h utilization:
- `t = max(0, min(1, (util - 20) / 70))` — mulai di 20%, full di 90%
- `radial-gradient(ellipse 150% 90% at bottom, ...)` — bara api naik dari bawah
- `background-attachment: fixed` — gradient fixed ke viewport saat scroll
- Transition: 3s ease
