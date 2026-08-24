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
Bandingkan `resets_at` dari upstream dengan threshold **> 30 menit**. Saat rotasi terdeteksi, behavior bergantung pada GLOBAL `settings.reset_mode`:
- `auto` → semua token di-reset (`used = 0`, `windowStart` align ke window baru)
- `manual` / `daily` → semua token TIDAK di-reset (decoupled dari Anthropic)

**Stale display**: Jika `resets_at` sudah lewat tapi poll belum berhasil, tampilkan ring sebagai 0%/gray ("waiting for poll") bukan data stale.

## Quota Reset Mode (single global setting)

Project ini punya **satu** setting `settings.reset_mode` yang mengontrol behavior quota refresh untuk SEMUA token. Tidak ada per-token override — single source of truth.

| Mode | Behavior | Use case |
|---|---|---|
| `manual` (default) | TIDAK pernah auto-reset. Quota hit → 429 sampai admin reset atau naikkan limit. | Budget control — admin punya kontrol penuh. |
| `auto` | Rolling window: reset tiap `window` ms (default 5h) DAN saat Anthropic 5h window rotate. | Behavior lama (Claude Max coupled). |
| `daily` | Reset sekali di local midnight (timezone server). Anthropic rotation di-ignore. | Lifecycle reset jelas, tidak coupled ke Anthropic. |

**Admin control:** Providers tab → "Quota Reset Mode" Select (POST `/admin/settings/reset-mode`). Berlaku INSTAN ke semua token.

**Indicators di UI:**
- Providers tab → panel "Quota Reset Mode" dengan Badge besar (warna sesuai mode)
- Admin Overview header → badge mini "quota: manual/auto/daily" di sebelah upstream status

**Implementation**: `checkReset()` di `src/tokens.ts` baca `getResetMode()` (yang baca `settings["reset_mode"]`, fallback `"manual"`). Untuk `manual` → return early. Untuk `auto` → rolling-window check. Untuk `daily` → bandingkan local-date dari `windowStart` vs sekarang. `upstream.ts poll()` skip Anthropic rotation entirely kalau `reset_mode !== "auto"`.

**Migration history (already deployed)**: `20260517085129_add_token_reset_mode` menambah column `tokens.reset_mode` + `tokens.last_reset`. Setelah refactor ke single-source, column `reset_mode` per-token **tidak lagi dipakai** oleh app code — boleh dibiarkan (harmless DB default) atau di-drop di housekeeping migration. Column `last_reset` masih dipakai untuk display per-token.

## Soft Cap
Kalau upstream 5-hour utilization ≥ `UPSTREAM_HARD_CAP_PCT` dan **tidak ada provider fallback** (DeepSeek/OpenRouter belum configured), semua request diblok dengan `429` + `retry-after`. Kalau fallback ada → auto-route ke OpenRouter (priority) atau DeepSeek.

## Provider Selection (priority order)

Urutan penentuan provider untuk tiap request di `proxy.ts`:

1. **Per-token override** (`tokens.provider !== "inherit"`) — paksa provider untuk token ini. Termasuk custom provider slug (e.g. "groq"). Kalau provider belum configured (API key kosong) → 503. Khusus `"anthropic"`: kalau no claude-*.json → 503.
2. **Global override** (`settings.provider_override`) — set lewat Providers tab. Bisa `"anthropic"`, `"deepseek"`, `"openrouter"`, custom slug, atau `""` (auto). Override `"anthropic"` di-skip diam-diam kalau no credential — auto-pick fallback.
3. **Auto-fallback** — kalau Anthropic available AND 5h util ≥ `UPSTREAM_HARD_CAP_PCT` AND built-in fallback configured → switch ke OpenRouter atau DeepSeek. Custom providers **TIDAK** ikut auto-fallback (admin harus pick explicit).
4. **Default** — `pickDefaultProvider()` di `src/providerSelection.ts`. Urutan: anthropic (jika cred ada) → openrouter → deepseek → first custom provider. Kalau semua kosong → 503 dengan pesan "No provider is configured".

**429 retry chain**: Kalau Claude balas 429 saat forward, code retry sekali dengan built-in fallback provider. Tidak ada chain berlapis — satu fallback attempt saja.

**529 overloaded retry**: Anthropic balas HTTP `529` + `overloaded_error` saat kapasitas upstream sesaat penuh — ini **transient**, bukan kuota. Client API langsung (Claude Code, SDK resmi) auto-retry dengan backoff, jadi blip tak terlihat oleh mereka. Sebelumnya proxy meneruskan 529 apa adanya, sehingga blip yang sama muncul sebagai kegagalan keras ("Overloaded") lewat proxy. Sekarang proxy retry sampai `MAX_OVERLOAD_RETRIES` (4) kali dengan **exponential backoff + full jitter** (honor `retry-after`, clamp 10s) sebelum menyerah dan meneruskan error. Aman di-retry: 529 ditolak sebelum diproses (tidak ada usage terpakai). Logika murni di `src/overloadRetry.ts` (testable), di-wire di `proxy.ts` sebelum handling 401/400/429. Test: `tests/overloadRetry.test.ts`.

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
- `messages[].content` (array atau string) — text content diekstrak
- **Tools**: `tools[].input_schema` → `tools[].function.parameters`; `tool_choice` (auto→`auto`, any→`required`, none→`none`, tool→`{type:function,function:{name}}`)
- **Tool history**: assistant `tool_use` block → `tool_calls[]`; user `tool_result` block → `role:"tool"` message dengan `tool_call_id`
- `max_tokens`, `temperature`, `top_p` di-pass through

**Response translation** (non-streaming, `openAiToAnthropic`):
- `choices[0].message.content` → `content: [{ type: "text", text }]`
- `choices[0].message.tool_calls[]` → `tool_use` content block (`JSON.parse(arguments)` → `input`; malformed → `{}`)
- `finish_reason` map: `stop` → `end_turn`, `length` → `max_tokens`, `tool_calls` → `tool_use`, dll
- `usage.prompt_tokens` → `usage.input_tokens`, `completion_tokens` → `output_tokens`

**Response translation** (streaming, `translateOpenAiStreamToAnthropic`):
- OpenAI SSE `data:` chunks → Anthropic SSE events: `message_start` → `content_block_start` → `content_block_delta` (text_delta) → `content_block_stop` → `message_delta` (stop_reason) → `message_stop`
- **Tool calls**: `delta.tool_calls` → `content_block_start` (tool_use w/ id+name) + `content_block_delta` (input_json_delta untuk arguments). Anthropic mengharuskan satu block terbuka per waktu — block sebelumnya (text/tool) ditutup sebelum block baru dibuka, sehingga text-then-tool dan parallel tool calls tetap valid.
- **Empty-completion guard**: kalau stream upstream berakhir tanpa satu pun content block (text maupun tool), translator emit SSE `error` event (`api_error`, sebutkan input tokens bila ada) alih-alih `message_stop` kosong. Latar: qwen free tier (`qwenapi`) balas `200` + `finish_reason: "stop"` + `completion_tokens: 0` **tanpa pesan error** saat input melebihi ± 43k token (diverifikasi 2026-08-11: 42.6k lolos, 46k kosong) — tanpa guard, client (Claude Code) melihat respons kosong "sukses" lalu retry tanpa henti. Usage chunk qwen datang dengan `choices: []`, karena itu capture `usage` dilakukan sebelum guard `choices[0]`.

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

## Approved-User Gating (Backend Authorization)

Hanya user dengan `status = "approved"` (atau admin) yang boleh melihat data
agregat milik user lain (leaderboard, mind graph, session, usage, status). Ini
**backend source of truth** — route guard React (`RequireAuth`) hanya UX; tanpa
gate backend, user pending/anonymous masih bisa fetch endpoint langsung.

**Dua helper di `src/index.tsx`:**
- `requireApprovedUser(req)` → return `{ userId, email }` kalau approved, `null`
  kalau tidak. Honor `demo_mode`: saat demo ON, `pending` diperlakukan approved
  (mirror `effectiveStatus` di `/api/profile`). Anonymous selalu `null`.
- `gateApproved(req)` → return `Response 403` kalau bukan approved user **dan**
  bukan admin; `null` kalau boleh lanjut. Dipakai untuk gate endpoint data.

**Endpoint yang di-gate** (403 untuk pending/anonymous, lolos untuk approved/admin):
`/api/status`, `/ws`, `/api/mind`, `/api/race`, `/api/competition`,
`/api/sessions/summary`, `/api/sessions/*`, `/api/usage/hourly`,
`/api/admin/user-activity`.

**Sengaja TIDAK di-gate** (pending wajib akses agar "parkir" di `/profile` jalan):
`/api/profile`, `/api/notifications/pending`, `/api/notifications/:id/dismiss`.

**`demo_mode` bukan kontrol keamanan** — itu UX toggle (auto-approve pending).
Gate tetap berlaku saat demo OFF; saat demo ON, pending diizinkan secara
konsisten dengan `/api/profile`.

**Test**: `tests/approvedGate.test.ts` — pure-function mirror dari
`requireApprovedUser`/`gateApproved` (approved/pending/blocked/anonymous ×
demo on/off + admin bypass).

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

## Batasan: field `system` diabaikan upstream OAuth (klien non-Claude-Code)

Request ke Anthropic via OAuth Claude Max (`anthropic-beta: oauth-2025-04-20`)
**mengabaikan field `system`** kalau request datang dari klien HTTP biasa
(curl, SDK, aplikasi sendiri). Proxy meneruskan field itu apa adanya — tidak ada
kode yang menghapusnya — tapi upstream tidak menerapkannya.

**Gejala:**
- Instruksi di `system` tidak dipatuhi model (jawaban seolah tanpa system prompt)
- `input_tokens` kecil tidak wajar — system 41.080 char (~10k token) → `input_tokens: 9`
- `cache_creation_input_tokens` = 0 walau `cache_control: ephemeral` dikirim dan
  prefix jauh di atas minimum cacheable (4096 token)

**Reproduksi** (2026-07-30, staging, `claude-opus-5`):

| Tes | Isi | Hasil |
|---|---|---|
| `system` sebagai string | instruksi canary | FAIL — diabaikan, `input=14` |
| `system` sebagai array of blocks | instruksi canary sama | FAIL — diabaikan, `input=14` |
| **Kontrol:** instruksi sama di **user turn** | instruksi canary sama | **PASS** — dipatuhi |
| Caching, 3× request identik | system 41.080 char + `cache_control` | FAIL — `cache_creation`/`cache_read` = 0 |

Kontrol PASS membuktikan model **mampu** mematuhi instruksinya dan metode tesnya
valid — jadi ini bukan penolakan model, melainkan `system` yang tidak berlaku.
Konsisten di `claude-opus-5`, `claude-sonnet-4-6`, dan `claude-opus-4-8`.

Sebaliknya, request Claude Code asli lewat proxy yang sama, di menit yang sama,
**tetap** mendapat `cache_creation` > 0 dan mematuhi system prompt-nya.

**Yang sudah dikesampingkan sebagai penyebab** (jangan diulang investigasinya):
- Proxy menghapus/menimpa `system` — tidak ada `delete bodyJson.system` di
  codebase; `sanitizeRequestBody()` tidak pernah menyentuh `system`
- Ekstensi — `log-management` tidak punya hook request sama sekali;
  `second-brain` `preRequest()` return null untuk `provider === "anthropic"`,
  dan injeksinya hanya prepend (system asli selalu dipertahankan)
- Gating per token/tier — tidak ada; proxy tidak pernah menyentuh `cache_control`
- Baris `x-anthropic-billing-header` di `system` — **sudah diuji**: menambahkannya
  ke request non-Claude-Code TIDAK membuat `system` berlaku
- Param `thinking` — FAIL juga terjadi tanpa param tersebut

Syarat persis yang divalidasi Anthropic **belum diketahui** (kemungkinan
fingerprint klien di luar satu baris header). Jangan klaim akar penyebab lebih
spesifik dari ini tanpa bukti baru.

**Workaround untuk pengguna:** taruh instruksi di **user turn pertama**, bukan di
field `system` — terbukti dipatuhi. Alternatif: pakai API key Anthropic berbayar
(bukan OAuth Max) lewat custom provider, di mana `system` bekerja normal.

**Implikasi untuk `count_tokens`:** `input_tokens` kecil pada request bersystem
besar bukan bug pencatatan proxy — memang itu yang dihitung upstream.

## Batasan: field `speed` (fast mode) di-strip by policy

Claude Code CLI ≥2.1.219 auto-inject `speed: "fast"` untuk model yang dikenalinya
sebagai Opus 5/4.8 saat fast mode aktif. Proxy **membuang field ini** sebelum
forward (`stripClientOnlyFields()` di `src/messageSanitizer.ts`, dipanggil dari
`proxy.ts`) — request jalan di kecepatan standar.

**Kenapa di-strip (dua alasan, keduanya diverifikasi 2026-08-06):**

1. **Tanpa strip, request 400.** Field `speed` butuh beta header
   `fast-mode-2026-02-01` menyertainya. `buildUpstreamRequest()` meng-overwrite
   `anthropic-beta` menjadi `oauth-2025-04-20` (fixed), sehingga flag fast-mode
   dari client hilang → Anthropic menolak dengan
   `400 "speed: Extra inputs are not permitted"`. Diverifikasi langsung ke
   `api.anthropic.com` dengan OAuth token Max: dengan header
   `oauth-2025-04-20,fast-mode-2026-02-01` field `speed` DITERIMA; dengan
   `oauth-2025-04-20` saja → 400.
2. **Kebijakan biaya.** Fast mode ditagih ke **usage credits** pemilik akun
   ($10/$50 per MTok dari token pertama), BUKAN kuota subscription Max — shared
   proxy tidak membiarkan user membakar credits pemilik akun. Karena itu fix-nya
   strip field, bukan merge beta header.

**Gejala tanpa strip (historis):** nama model dikenal CLI (mis. `claude-opus-5`)
→ 400; nama model typo (mis. `claude-opus5`) → jalan normal, karena CLI hanya
inject `speed` untuk model yang dikenalinya.

Kalau suatu saat fast mode mau diizinkan (mis. per-token gating), yang perlu
diubah: berhenti strip `speed` + merge flag client ke header `anthropic-beta`
di `buildUpstreamRequest()` alih-alih overwrite.

## /mind Graph (User → Date → Hour → Request)
`GET /api/mind` group `request_logs` (max 2000) menjadi 4 tier:
- **Cat 0** User — ukuran √(requests/maxUser)
- **Cat 1** Date (YYYY-MM-DD)
- **Cat 2** Hour (HH:00)
- **Cat 3** Request leaf — ukuran √(tokens/maxTok)

Link types: `ud` (user→date), `dh` (date→hour), `hr` (hour→request).

## FOUC Prevention
`index.html` punya inline script yang set `data-mantine-color-scheme` + `background-color` sebelum CSS/JS load, berdasarkan `localStorage("mantine-color-scheme-value")` atau `prefers-color-scheme`.

## Admin Broadcast Notifications

Admin bisa kirim modal pemberitahuan ke user via Admin → Users → "Send Notification".

**Targeting:**
- `target_type = "all"` — semua user yang authenticated lihat modal
- `target_type = "specific"` — hanya `target_ids[]` (user IDs) yang lihat

**Lifecycle:**
1. Admin POST `/api/admin/notifications` → row baru di `admin_notifications`
2. Server push WS `{ type: "notif_changed" }` ke SEMUA client (broadcast bukan targeted — client refetch dan filter sendiri di server side)
3. Setiap client authenticated mount `UserNotificationModal` yang fetch `/api/notifications/pending` saat mount + saat terima `notif_changed`
4. Server filter pending list per user: skip yang sudah ada di `notification_dismissals` (per-user) + skip yang `target_type=specific` tapi user bukan target
5. User klik "Saya mengerti" → POST `/api/notifications/:id/dismiss` → insert row ke `notification_dismissals` → modal advance ke notifikasi berikutnya (kalau ada)
6. Admin klik Delete → `deleted=true` (soft delete) → broadcast `notif_changed` → semua client refetch, notifikasi hilang dari pending

**Dismissal model**: sekali close = selesai untuk user itu. Tidak ada expiry — admin yang hapus.

**Ordering**: oldest-first (FIFO). Kalau ada 3 notifikasi pending, user lihat yang paling lama dulu, close, lalu yang berikutnya.

**Anti-spoofing**: dismiss endpoint validate user adalah target (untuk `specific` type) — 404 kalau bukan, biar user lain tidak bisa "tandai sudah baca" milik orang lain.

**MCP debug tool**: `check_notifications` (dev & stg) — list semua notifikasi aktif + dismissed_count per item. Useful untuk verifikasi broadcast sampai dan track adopsi.

## Dynamic Background (Public Page `/`)
Background public page shift ke gradient dark red sesuai upstream 5h utilization:
- `t = max(0, min(1, (util - 20) / 70))` — mulai di 20%, full di 90%
- `radial-gradient(ellipse 150% 90% at bottom, ...)` — bara api naik dari bawah
- `background-attachment: fixed` — gradient fixed ke viewport saat scroll
- Transition: 3s ease
