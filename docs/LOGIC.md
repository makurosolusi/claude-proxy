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
Kalau upstream 5-hour utilization ≥ `UPSTREAM_HARD_CAP_PCT` dan **tidak ada provider fallback** (DeepSeek/OpenRouter belum configured), semua request diblok dengan `429` + `retry-after`. Kalau fallback ada → auto-route ke OpenRouter (priority) atau DeepSeek.

## Provider Selection (priority order)

Urutan penentuan provider untuk tiap request di `proxy.ts`:

1. **Per-token override** (`tokens.provider !== "inherit"`) — paksa provider untuk token ini. Termasuk custom provider slug (e.g. "groq"). Kalau provider belum configured (API key kosong) → 503. Khusus `"anthropic"`: kalau no claude-*.json → 503.
2. **Global override** (`settings.provider_override`) — set lewat Providers tab. Bisa `"anthropic"`, `"deepseek"`, `"openrouter"`, custom slug, atau `""` (auto). Override `"anthropic"` di-skip diam-diam kalau no credential — auto-pick fallback.
3. **Auto-fallback** — kalau Anthropic available AND 5h util ≥ `UPSTREAM_HARD_CAP_PCT` AND built-in fallback configured → switch ke OpenRouter atau DeepSeek. Custom providers **TIDAK** ikut auto-fallback (admin harus pick explicit).
4. **Default** — `pickDefaultProvider()` di `src/providerSelection.ts`. Urutan: anthropic (jika cred ada) → openrouter → deepseek → first custom provider. Kalau semua kosong → 503 dengan pesan "No provider is configured".

**429 retry chain**: Kalau Claude balas 429 saat forward, code retry sekali dengan built-in fallback provider. Tidak ada chain berlapis — satu fallback attempt saja.

## Operation Mode (Anthropic optional)

Aplikasi awalnya didesain dengan Claude Max OAuth sebagai primary. Sekarang Anthropic **opsional** — aplikasi tetap berjalan tanpa credential Claude.

Mode ditentukan `getOperationMode()` di `src/providerSelection.ts`:

| Mode | Kondisi | Behavior |
|---|---|---|
| `anthropic-primary` | Ada usable `claude-*.json` di `CLIPROXY_AUTH_DIR` | Default Anthropic, fallback ke OR/DS saat 5h cap atau 429 |
| `fallback-only` | No Anthropic cred, tapi DeepSeek/OpenRouter/custom configured | Semua request via fallback provider; poll Anthropic di-throttle 10 menit; UI tampil informational banner biru |
| `no-provider` | Tidak ada satupun configured | Boot log warning; admin Overview banner merah; semua `/v1/messages` → 503 |

**Boot log** mencantumkan mode + fallbacks tersedia: `[boot] mode=fallback-only · anthropic=off · routing via=[openrouter, deepseek]`.

**Poll throttling**: Saat `getOauthCredential()` return null 3x berturut-turut, poll interval naik ke 10 menit + log throttled (sekali per 10 menit) untuk hindari spam log saat Anthropic intentionally disconnected.

**UI graceful degradation**:
- `apiTest.ts` skip Anthropic tests (skipped:true, ok:true) — Test tab tidak tampil merah
- `apiModels.ts` untuk anthropic return `{ models: [], disabled: true }` status 200 — bukan 502
- `apiStatus.ts` set `anthropicAvailable` + `operationMode` di response
- `UpstreamSection` (shared) render informational banner saat fallback-only mode
- Admin Overview tampil banner di atas dashboard

**Second Brain mining cross-provider**: Strategy distillation bisa pakai Anthropic, OpenRouter, atau DeepSeek. Config `miningProvider` (`auto | anthropic | openrouter | deepseek`) di Brain → Settings. Worker silent-skip kalau no provider configured (tidak retry loop pg-boss).

## Custom Providers

Selain built-in (Claude/DS/OR), admin bisa add custom API-key providers via `Credentials → Custom Providers`:

- Storage: JSON di `settings.custom_providers` (id, name, type, base_url, api_key, color)
- Types:
  - **anthropic-like**: forward `/v1/messages` as-is ke `base_url`
  - **openai-like**: proxy translate request body Anthropic → OpenAI `/v1/chat/completions`, lalu translate response SSE stream balik ke Anthropic format. Implementation di `src/openaiTranslate.ts`.
- API endpoints:
  - `GET/POST /api/admin/custom-providers` — CRUD (api_key di-mask di GET)
  - `DELETE /api/admin/custom-providers/:id`
  - `GET /api/admin/models/:id` — fetch `/v1/models` dari provider, cache 30 menit
  - `GET /api/admin/test/:id` — generic test, auto-pick model pertama dari `/v1/models`

## Pinned Model per Token

`tokens.pinned_model` (nullable) — kalau di-set, semua request untuk token ini di-rewrite ke model itu, **mengabaikan** model yang dikirim client.

- **Universal**: berlaku untuk semua provider (Claude, DS, OR, custom). Untuk OpenAI-like custom provider, pin diteruskan ke `model` field di OpenAI body.
- **Wajib untuk custom provider** — kalau token pakai custom + tidak ada pin → request gagal 400 dengan pesan jelas (built-in DS/OR ada fallback default `toProviderModel()`).
- **Bulk action**: `POST /admin/token/pin-all` dengan `model` (kosong = clear) + optional `user_id` filter + optional `provider_scope` (effective routing match).
- **Per-user reset**: tombol "Reset Pinned" di card tiap user — call `pin-all` dengan `model=""` + `user_id=u.id`.
- **Backend response**: `{ ok: true, count: N }` — jumlah token actual yang ter-pin (frontend tampilkan jika 0).

UI menampilkan **state agregat** via effective routing (mirrors proxy.ts): kalau semua token effective ke provider X dengan pin yang sama → tombol itu aktif (✓). Kalau campur → "Mixed". Effective routing = `tokenProvider !== "inherit" ? tokenProvider : globalOverride || "anthropic"` (dengan configured check).

## OpenAI ↔ Anthropic Translation

Custom provider type `"openai"` butuh translation karena client Claude Code mengirim request format Anthropic, tapi provider expect OpenAI format.

**Request translation** (`anthropicToOpenAi`):
- `system` (top-level atau content blocks) → first `system` message di OpenAI `messages` array
- `messages[].content` (array atau string) — diekstrak text content saja (tool_use/result tidak supported di MVP)
- `max_tokens`, `temperature`, `top_p` di-pass through

**Response translation** (non-streaming, `openAiToAnthropic`):
- `choices[0].message.content` → `content: [{ type: "text", text }]`
- `finish_reason` map: `stop` → `end_turn`, `length` → `max_tokens`, dll
- `usage.prompt_tokens` → `usage.input_tokens`, `completion_tokens` → `output_tokens`

**Response translation** (streaming, `translateOpenAiStreamToAnthropic`):
- OpenAI SSE `data:` chunks → Anthropic SSE events: `message_start` → `content_block_start` → `content_block_delta` (text_delta) → `content_block_stop` → `message_delta` (stop_reason) → `message_stop`
- Text-content only di MVP — tool_use/thinking blocks tidak ditranslate

## Settings Storage

Key settings di tabel `settings` (`{ key, value }`):

| Key | Type | Default | Purpose |
|---|---|---|---|
| `provider_override` | string | `""` (auto) | Global routing target |
| `poll_interval_ms` | string (ms) | `60000` | Upstream `/api/oauth/usage` poll frequency |
| `deepseek_api_key` | string | — | DS Bearer token |
| `deepseek_base_url` | string | env default | DS endpoint |
| `deepseek_model` | string | hardcoded fallback | DS default model (no UI edit, set via env or DB direct) |
| `openrouter_api_key` | string | — | OR Bearer token |
| `openrouter_base_url` | string | env default | OR endpoint |
| `openrouter_model` | string | hardcoded fallback | OR default model (no UI edit) |
| `custom_providers` | JSON array | `[]` | Custom provider list (id/name/type/base_url/api_key/color) |
| `demo_mode` | "true"\|"false" | `"false"` | Auto-approve pending users |

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
