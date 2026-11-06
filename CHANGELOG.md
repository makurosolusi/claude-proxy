# Changelog

## [2.1.88] - 2026-11-06

### Added
- **Identitas credential** di `Admin → Credentials`: tiap baris kini menampilkan label, waktu login (`created_at`), terakhir dipakai (last used), dan terakhir refresh; judul baris = label atau email, dengan badge "email unknown" kalau email belum terselesaikan. Sebelumnya semua credential tampil sebagai `account-<timestamp>`, sehingga admin tidak tahu credential itu milik akun mana
- Label credential bisa diedit inline — `POST /api/admin/credentials/label` `{ file, label }` → `{ ok, label }`. Label di-trim, maks 60 karakter, dan `""` menghapusnya
- Tombol resolve email untuk credential lama — `POST /api/admin/credentials/resolve-email` `{ file }` → `{ ok, email, changed }`. Kalau profile endpoint membalas 401, token di-refresh sekali lalu dicoba ulang; gagal → `502`. File tidak di-rename, dan pin `anthropic_account` ikut dipindah kalau email berubah
- `GET /api/admin/credentials` dan `GET /api/debug/anthropic-accounts` (tool MCP `check_anthropic_accounts`) membawa field additive `label`, `created_at`, `last_refresh`, `last_used_at`, `email_resolved`; endpoint debug juga membawa `unresolved_count`
- Last used disimpan di `settings.credential_last_used` dengan persist di-throttle 1×/60 detik — nilai di DB bisa tertinggal ≤60 detik, dan ≤60 detik terakhir hilang saat restart

### Fixed
- Credential baru tidak lagi tersimpan sebagai `claude-account-<ms>.json` tanpa email. Penyebabnya lookup profile memanggil path salah `/api/auth/oauth/profile` (404) dan error-nya ditelan `catch` kosong. Sekarang email diambil dari respons token exchange → `/api/oauth/profile` → fallback `account-<ts>` dengan warning di log
- Login ulang akun yang sama tidak lagi membuat file credential duplikat — file lama ditimpa dengan token baru, sementara label dan waktu login dipertahankan

### Changed
- `src/handlers/apiAuth.ts` dipecah: alur OAuth PKCE pindah ke `src/oauthPkce.ts` dan penyimpanan file credential ke `src/credentialSave.ts`, tanpa perubahan perilaku
- Tidak ada perubahan schema maupun migration; upgrade cukup deploy ulang

## [2.1.87] - 2026-10-28

### Added
- **Bulk Switch Model** di `Admin → Users → Bulk Actions`: admin bisa mengganti **satu** model di dalam allowlist sekelompok token sekaligus — misalnya menurunkan semua token yang masih memakai `claude-opus-5` ke `claude-sonnet-5` demi kontrol biaya — tanpa mengganggu model lain yang ada di daftar token yang sama. Ini melengkapi bulk pin yang sudah ada, yang sifatnya all-or-nothing: `pin-all` menyamaratakan allowlist tiap token menjadi satu model yang sama, sehingga token yang sebelumnya boleh memakai haiku untuk background task ikut kehilangan izin itu. Bulk switch menukar model di posisinya semula, jadi urutan prioritas tetap — elemen pertama yang berperan sebagai model default sekaligus target redirect tidak bergeser hanya karena satu entri diganti
- Endpoint admin `POST /admin/token/swap-model` untuk memanggil aksi yang sama secara programatik. Field yang diterima: `from` (wajib, dibalas `400` kalau kosong), `to` (opsional — dikosongkan berarti mencabut model itu tanpa pengganti), `user_id` (opsional, membatasi aksi ke token milik satu user), `provider_scope` (opsional, memfilter berdasarkan provider efektif tempat token itu benar-benar dirutekan), dan `include_unrestricted`. Response-nya `{ ok, count }`
- Perlakuan khusus saat model tujuan ternyata **sudah** ada di allowlist token yang diproses: `from` dicabut, bukan ditimpa dengan `to`. Menimpanya akan menghasilkan dua entri `to` yang sama dalam satu daftar sekaligus memindahkan `to` keluar dari posisi prioritasnya semula — dua efek samping yang tidak diminta admin ketika ia hanya ingin menyingkirkan satu model
- Token **tanpa batasan** (allowlist kosong, hari ini boleh memanggil model apa pun) secara default **dilewati** dan tidak ikut terpengaruh. Token itu baru ikut kalau checkbox "Also pin unrestricted tokens" dicentang **dan** field "To" terisi, karena bagi token tanpa batasan aksi ini artinya mempersempit akses — dari bebas sepenuhnya menjadi satu model saja. Karena konsekuensinya besar dan tidak bisa dibatalkan dengan sekali klik, checkbox-nya default OFF dan terkunci selama "To" masih kosong ("mencabut model" tidak punya arti untuk token yang memang tidak punya daftar)
- Angka `count` pada response hanya menghitung token yang allowlist-nya benar-benar berubah, bukan jumlah token yang lolos filter — jadi token yang kebetulan tidak memakai `from` tidak ikut dihitung dan tidak ditulis ulang ke database. Konsekuensinya `count: 0` adalah informasi yang berguna, bukan kegagalan diam: artinya tidak ada satu pun token di scope itu yang memakai `from`, dan UI memunculkan notifikasi kuning "No tokens changed" alih-alih notifikasi sukses yang menyesatkan
- Pratinjau "N token(s) will change" di modal, yang dihitung ulang setiap kali admin mengubah pilihan "From", "To", filter user, atau checkbox. Pratinjau itu menjalankan fungsi `swapModel()` yang sama persis dengan yang dipakai backend saat menulis, jadi angka yang dilihat admin sebelum menekan tombol tidak bisa melenceng dari jumlah token yang benar-benar berubah sesudahnya
- Tidak ada perubahan schema maupun migration untuk rilis ini. Fitur ini sepenuhnya memakai kolom `tokens.allowed_models` yang sudah ada sejak 2.1.86, sehingga upgrade cukup deploy ulang tanpa langkah database apa pun

### Fixed
- Daftar request log di admin UI tidak lagi bisa menampilkan baris yang sama di dua halaman berbeda, atau melewatkan satu baris sama sekali, ketika beberapa request mendarat di milidetik yang sama. Kolom `request_logs.ts` menyimpan epoch milidetik, dan `dbQueryLogs` di `src/state.ts` — yang juga melayani endpoint `GET /api/logs` — hanya mengurutkan dengan `ts` menurun; begitu beberapa baris punya `ts` identik, PostgreSQL tidak menjamin urutan yang sama antara dua query `LIMIT/OFFSET` yang terpisah, sehingga satu baris bisa muncul lagi di halaman berikutnya sementara baris lain tergeser keluar dan tidak pernah terlihat. Urutannya kini dipecah dengan `id` (kolom auto-increment yang unik dan monoton) sebagai kriteria kedua, jadi paginasi menjadi deterministik tanpa perlu index baru maupun migration

## [2.1.86] - 2026-10-28

### Added
- Satu token API kini bisa diizinkan memakai **beberapa** model sekaligus, bukan hanya satu model yang di-pin. Admin menentukannya per token — misalnya satu token boleh memakai haiku, `claude-sonnet-4-6`, dan `claude-opus-5` sekaligus, sehingga user tidak lagi harus memilih antara "dikunci ke satu model" atau "bebas sepenuhnya". Daftarnya tersimpan di kolom baru `tokens.allowed_models` (Postgres `TEXT[]`)
- Satu aturan resolusi yang sama untuk semua provider, di `resolveModel` pada `src/modelAllowlist.ts`: daftar berisi 0 item berarti tanpa batasan (model apa pun yang diminta klien diteruskan apa adanya), 1 item identik dengan perilaku pin yang lama (semua request di-rewrite ke model itu), dan 2 item atau lebih berarti model yang diminta lolos kalau memang terdaftar. **Urutan daftar adalah urutan prioritas** — elemen pertama berperan sebagai model default sekaligus target redirect, jadi admin mengurutkan daftar sesuai model yang paling ingin dipakai
- Model di luar daftar di-**redirect** ke model pertama dalam daftar, bukan dibalas `400`. Alasannya konkret: Claude Code hardcode haiku untuk background task-nya (membuat judul percakapan dan sejenisnya), jadi membalas error akan mematikan task-task itu diam-diam tanpa pesan apa pun yang terlihat user. Dengan redirect, background task tetap jalan di model yang memang diizinkan, dan request yang ter-redirect membawa header response `x-model-fallback` supaya kejadiannya tetap bisa dilacak
- Endpoint admin `POST /admin/token/allowed-models` untuk mengeset daftar per token (comma-separated; daftar kosong berarti token itu tanpa batasan), lengkap dengan UI pengaturannya di panel admin sehingga tidak perlu menyentuh database langsung
- MCP debug tool `check_token_models` di `proxy-dev` dan `proxy-stg` (di belakangnya endpoint `GET /api/debug/token-models`) untuk melihat token mana yang sudah multi-model, mana yang masih single-pin, dan mana yang tanpa batasan — tanpa perlu SSH ke server atau membuka admin UI

### Changed
- `GET /v1/models` kini hanya mengembalikan model yang ada di allowlist token, dalam urutan allowlist, selama allowlist-nya tidak kosong. Ini juga berlaku untuk token berisi tepat 1 model, yang sebelumnya tetap melihat katalog penuh provider meski semua request-nya dipaksa ke satu model. Bentuk response tidak berubah, hanya isinya yang menyempit mengikuti izin token
- Field `pinned_model` **dipertahankan** sebagai mirror turunan read-only: nilainya adalah item tunggal itu kalau `allowed_models` berisi tepat 1 item, dan string kosong untuk kasus lainnya. Field itu tidak dihapus karena merupakan kontrak publik yang muncul di response `/api/profile` dan `/api/status`. Konsekuensi yang perlu diketahui konsumen: untuk token multi-model nilainya kosong, jadi konsumen mana pun yang masih membaca field itu akan melaporkan "tanpa pin" secara menyesatkan — baca `allowed_models` untuk mengetahui state yang sebenarnya
- Migration `20261028000000_add_token_allowed_models` menambah kolom secara idempotent (`ADD COLUMN IF NOT EXISTS`) dan mem-backfill daftarnya dari `pinned_model` yang sudah ada, sehingga token yang sudah di-pin sebelum upgrade tidak berubah perilakunya sedikit pun setelah upgrade

### Fixed
- Panel bulk-pin di admin tidak lagi salah melaporkan token multi-model sebagai "Auto — no pin". Panel itu membaca `pinned_model`, yang untuk token multi-model memang kosong, sehingga token yang sebenarnya dibatasi ke beberapa model tampil seolah tanpa batasan sama sekali — admin bisa menyimpulkan sebaliknya dari apa yang sudah ia set sendiri

## [2.1.85] - 2026-10-23

### Fixed
- Peringatan `API Error: Connection lost mid-response. The response above may be incomplete.` di Claude Code kini jauh lebih jarang muncul, dan kalau muncul Claude Code bisa retry sendiri. Stream SSE yang mati di tengah — upstream menjatuhkan body, atau client pergi sehingga penulisan ke client reject — sebelumnya selalu berakhir sebagai *clean close*: client menerima HTTP 200 yang well-formed tapi SSE-nya tidak pernah mencapai `message_stop`, jadi tidak ada network error untuk dipicu retry otomatisnya dan user melihat peringatan itu. Di log staging 7 hari terakhir, 143 dari 46.862 request streaming (0,31%) berakhir seperti itu — semuanya 200 dengan `output_tokens` 0, dan 69% mati tepat setelah `message_start` (belum ada teks sama sekali), tersebar rata maksimal 8/jam jadi sistemik, bukan insiden. Angka itu batas atas: user yang menekan Esc menghasilkan signature log yang identik. Pump SSE kini tinggal di modul `src/sseRelay.ts` yang memegang terminal state stream — sukses `close()`, gagal `writer.abort(err)` supaya client melihat network error nyata yang bisa di-retry, plus `reader.cancel()` agar proxy berhenti menarik byte upstream yang sudah tidak ada pembacanya. Detail di `docs/LOGIC.md` section "Stream Error Propagation (SSE)"
- Kegagalan stream sekarang meninggalkan jejak yang bisa didiagnosis: `request_logs.stop_reason` diisi `client_disconnect` (client menutup koneksi) atau `upstream_error` (upstream menjatuhkan body). Sebelumnya kedua kasus punya signature identik — 200 dengan `stop_reason` kosong — sehingga "upstream drop" tidak bisa dipisahkan dari "user tekan Esc". Tidak butuh migration, langsung bisa di-query
- Client yang memakai format OpenAI chat ikut mendapat error yang benar. `translateAnthropicStreamToOpenAi` di `src/openaiTranslate.ts` kehilangan `controller.error(e)`, sehingga `finally`-nya mengubah abort balik menjadi clean close dan fix di atas tidak akan pernah sampai ke jalur itu

## [2.1.84] - 2026-10-19

### Added
- Pemilihan akun Claude eksplisit saat ada lebih dari satu credential `claude-*.json`. Admin → Accounts kini bisa **pin** akun mana yang melayani request (`Use this account` / `Back to auto`), dan badge menunjukkan akun yang sedang `serving` vs yang di-`pinned`. Pin tersimpan di `settings.anthropic_account` — `""` berarti auto (akun usable pertama)
- Tombol **Enable** untuk akun yang sebelumnya di-disable. Sebelumnya disable adalah pintu satu arah: tidak ada endpoint untuk mengaktifkan kembali, jadi satu kali salah klik berarti harus edit file credential manual di server
- Peringatan di UI kalau akun yang di-pin tidak tersedia (hilang/disabled) dan request jatuh ke akun lain — pin yang mati tidak mematikan Anthropic, hanya memunculkan warning
- MCP debug tool `check_anthropic_accounts` di `proxy-dev` dan `proxy-stg` untuk melihat akun mana yang pinned vs serving tanpa perlu SSH atau buka admin UI

### Fixed
- Pemilihan akun tidak lagi bergantung urutan filesystem. Listing credential sebelumnya memakai `readdir` tanpa sort, sehingga "akun pertama yang usable" bisa berbeda antara mesin lokal (APFS) dan server (ext4) untuk set credential yang sama
- Refresh OAuth token tidak lagi bisa mengembalikan token akun yang salah. Mutex global `isRefreshing` diganti dedupe per file credential — refresh token Anthropic single-use dan rotate, jadi dua akun yang refresh bersamaan sebelumnya bisa saling membajak hasilnya. Refresh akun non-aktif juga tidak lagi menimpa cache akun yang sedang melayani
- Status ketersediaan Anthropic tidak lagi basi sampai 30 detik setelah akun terakhir di-disable. Cache `hasAnthropicCredential()` kini selalu dibuang bersama cache token

## [2.1.83] - 2026-08-24

### Fixed
- Request lewat proxy tidak lagi gagal keras saat Anthropic membalas `529 overloaded_error` (kapasitas upstream sesaat penuh). Error ini **transient** dan client API langsung (Claude Code, SDK resmi) meng-auto-retry-nya, jadi blip tak terlihat oleh mereka; proxy sebelumnya meneruskannya mentah-mentah sehingga muncul sebagai kegagalan "Overloaded". Proxy kini retry sampai 4x dengan exponential backoff + full jitter (menghormati header `retry-after`, clamp 10s) sebelum menyerah. Aman di-retry: 529 ditolak upstream sebelum diproses (tidak ada usage terpakai). Detail di `docs/LOGIC.md` section "Provider Selection" → "529 overloaded retry"

## [2.1.82] - 2026-08-11

### Fixed
- Custom provider OpenAI-like yang membalas respons kosong (HTTP 200, 0 token output — mis. qwen free tier saat input melebihi ± 43k token) kini di-surface sebagai error eksplisit ke client, bukan stream kosong yang tampak sukses. Claude Code sebelumnya menampilkan "no visible output" lalu retry tanpa henti; sekarang muncul pesan error jelas berisi jumlah input token dan kemungkinan penyebab (context limit provider). Detail di `docs/LOGIC.md` section "OpenAI ↔ Anthropic Translation" → "Empty-completion guard"

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
