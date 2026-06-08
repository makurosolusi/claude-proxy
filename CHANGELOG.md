# Changelog

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
