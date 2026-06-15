# Changelog

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
