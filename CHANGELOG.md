# Changelog

## [2.1.81] - 2026-08-06

### Fixed
- Request dari Claude Code CLI dengan model Opus 5 (fast mode aktif) tidak lagi gagal `400 "speed: Extra inputs are not permitted"`. CLI ≥2.1.219 otomatis menyisipkan field `speed: "fast"` untuk model Opus yang dikenalinya; proxy kini membuang field itu sebelum forward sehingga request berjalan normal di kecepatan standar. Fast mode sengaja tidak diteruskan: penggunaannya ditagih ke usage credits pemilik akun ($10/$50 per MTok), bukan kuota subscription — detail di `docs/LOGIC.md` section "Batasan: field `speed`"

## [2.1.80] - 2026-07-30

### Fixed
- `POST /v1/messages/count_tokens` kini meneruskan request ke Anthropic dan mengembalikan hitungan token sebenarnya. Sebelumnya selalu balas `{input_tokens: 0}` tanpa pernah menghubungi upstream, sehingga client yang mengandalkannya tidak dapat angka yang berguna. Kalau tidak ada credential Anthropic atau upstream gagal, tetap balas `0` seperti perilaku lama — jadi tidak ada request yang jadi gagal

### Documentation
- Catat batasan: field `system` **diabaikan** upstream OAuth Claude Max untuk client HTTP biasa (curl/SDK/aplikasi sendiri) — instruksi tidak dipatuhi, `input_tokens` kecil tak wajar, dan prompt caching tidak aktif. Ini batasan upstream, bukan bug proxy: proxy meneruskan field tersebut apa adanya. Workaround: taruh instruksi di user turn pertama (terbukti dipatuhi), atau pakai API key Anthropic berbayar lewat custom provider. Detail reproduksi + daftar penyebab yang sudah dikesampingkan ada di `docs/LOGIC.md`

## [2.1.79] - 2026-07-23

### Changed
- Token Usage panel: semua user (bukan cuma admin) kini melihat seluruh grup user, tidak lagi dibatasi 6 kartu. Batas keras `isAdmin ? 20 : 6` diganti pagination 12 grup per halaman (pager tersembunyi bila hanya 1 halaman)

## [2.1.78] - 2026-06-23

### Fixed
- Custom provider OpenAI-like (mis. 9router/OpenRouter): tool calling tidak jalan — model balas teks/XML mentah atau "tool not supported". Direction A (Anthropic→OpenAI) sebelumnya tidak meneruskan `tools`/`tool_choice` dan tidak menerjemahkan riwayat `tool_use`/`tool_result`, jadi provider tak pernah tahu ada tools
- Translasi tool kini lengkap di kedua jalur respons: non-streaming (`tool_calls` → `tool_use` block, `JSON.parse` argumen dengan guard malformed → `{}`) dan streaming (`content_block_start`/`input_json_delta`, menutup block sebelumnya agar memenuhi constraint Anthropic satu block terbuka per waktu — text-then-tool & parallel tool calls tetap valid)

## [2.1.77] - 2026-06-19

### Added
- Token Usage panel: toggle grid view / list view (preferensi tersimpan di `localStorage`)

### Changed
- Token Usage: paper/card pembungkus tunggal dihapus — tiap user kini punya card sendiri

## [2.1.76] - 2026-06-18

### Security
- Backend approved-user gating: user pending/anonymous tidak lagi bisa fetch data agregat milik user lain. Endpoint `/api/status`, `/ws`, `/api/mind`, `/api/race`, `/api/competition`, `/api/sessions/summary`, `/api/sessions/*`, `/api/usage/hourly`, `/api/admin/user-activity` kini balas 403 kecuali approved user atau admin
- Gate honor `demo_mode` (pending diperlakukan approved saat demo ON) agar konsisten dengan `/api/profile`; endpoint `/profile` + notifikasi sengaja tetap terbuka untuk pending

## [2.1.75] - 2026-06-15

### Added
- Pagination level-user di admin Users tab (10 user/halaman) — sebelumnya semua user dirender sekaligus tanpa batas
- Per-token pagination di grid view `UserCard` (5 token/halaman, expandable 10) + tombol expand/collapse + max-height 400/720px
- Pagination user-level reset ke halaman 1 saat search atau sort berubah

## [2.1.74] - 2026-06-15

### Fixed
- Custom provider (OpenAI-like) test endpoint gagal "failed to parse json" saat provider default ke SSE streaming — test request sekarang eksplisit kirim `stream: false`

### Added
- Test suite `tests/openaiTranslate.test.ts` — 16 test cover: stream passthrough, message/system translation, response mapping (stop_reason, usage), dan regression guard untuk bug stream

## [2.1.73] - 2026-06-12

### Fixed
- Custom provider (OpenAI-like) tidak bisa di-set sebagai provider token — validasi di `/admin/token/provider` sekarang menerima custom provider slug selain built-in (anthropic/deepseek/openrouter)
- `TokenProvider` type diperluas dengan `(string & {})` agar custom slug valid secara TypeScript

### Changed
- User PENDING (belum disetujui admin) sekarang diredirect ke `/profile` saat mencoba akses halaman manapun — sebelumnya ke `/menunggu` yang merupakan halaman buntu
- `/profile` sekarang memerlukan login — pengguna yang belum login tidak bisa akses langsung

### Added
- `RequireLogin` component di `shared.tsx` — cek login saja tanpa cek status approval, dipakai untuk melindungi `/profile`
- Test suite `tests/authGate.test.ts` — 18 test cover semua flow: pending/blocked/approved/unauthenticated untuk RequireAuth dan RequireLogin
- Test suite `tests/customProvider.test.ts` — 14 test cover validasi custom provider slug

## [2.1.72] - 2026-06-11

### Fixed
- Fable 5 HTTP 400 error: proxy sekarang strip `thinking: { type: "disabled" }` sebelum request dikirim ke model Fable — model ini pakai adaptive thinking secara default dan menolak flag tersebut
- Retry mechanism (`isThinkingIncompatibleError`) sekarang mendeteksi error `"thinking.type.disabled" is not supported` sebagai safety net untuk model Fable yang belum dikenal
- `thinking: { type: "enabled" }` dan thinking blocks di history tetap dipreserve untuk Fable (tidak ikut di-strip)

### Added
- Test suite `tests/messageSanitizer.test.ts` — 21 test yang cover: getCapabilities per model family, sanitizeRequestBody Fable/Haiku, stripAllThinking, isThinkingIncompatibleError semua pola error

## [2.1.70] - 2026-06-08

### Changed
- Dashboard sekarang mobile-first: tidak ada lagi horizontal overflow ketika viewport diperkecil
- CSS Grid kolom utama diganti dari `1fr` ke `minmax(0, 1fr)` + direct children `min-width: 0` — ini root fix yang mencegah kolom grid membesar melebihi viewport
- Nilai stat card (Today, All-Time) ukuran font diturunkan dari 20→16px di mobile agar angka besar tidak meluap kartu
- Paper Upstream Health dan hourly activity mendapat `overflow: hidden` eksplisit
- Chart "Daily Token Usage per User" pakai `containLabel: true` + margin relatif (sebelumnya `left: 60px` fixed)
- Chart "Peak Hours" margin kiri diperkecil dari 40px ke 10px (y-axis label dinonaktifkan, tidak perlu space sebesar itu)
- Chart "Model Distribution" legend dipindah dari kanan vertikal ke bawah horizontal — lebih baik di layar narrow
- Gauge `UpstreamHealth` tampil 1 kolom di mobile (sebelumnya 2 kolom bisa terlalu sempit)

### Added
- Komponen `TruncText` di `shared.tsx`: angka panjang yang terpotong (elipsis aktif) kini menampilkan tooltip dengan nilai lengkapnya — hanya muncul saat benar-benar terpotong, menggunakan `ResizeObserver`
- `TruncText` diterapkan pada nilai Today dan All-Time di stat cards Dashboard, serta nilai All-Time per user di LeaderboardPanel
