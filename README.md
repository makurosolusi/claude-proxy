# claude-proxy

Proxy untuk satu akun Claude Max (OAuth) yang dibagi ke banyak user lewat API key masing-masing, lengkap dengan quota, dashboard admin, dan fallback ke provider lain (OpenRouter, DeepSeek, atau custom).

- Klien (Claude Code, SDK Anthropic, curl) cukup mengarah ke proxy ini dan memakai API key `sk-cp-...`.
- Admin mengatur user, quota, model yang boleh dipakai, dan akun Claude dari dashboard web.
- Akun Claude **opsional**: tanpa credential Claude, proxy tetap jalan lewat OpenRouter/DeepSeek/custom provider.

## Persyaratan

| Kebutuhan | Keterangan |
|---|---|
| [Bun](https://bun.sh) ≥ 1.3 | Runtime + package manager |
| PostgreSQL ≥ 14 | Penyimpanan utama (lewat Prisma) |
| Google OAuth Client | Login dashboard hanya lewat Google. Buat di [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → *OAuth client ID* → *Web application*. Authorized redirect URI: `<BETTER_AUTH_URL>/api/auth/callback/google` |
| Akun Claude Max/Pro | Opsional. Atau siapkan API key OpenRouter/DeepSeek sebagai gantinya |
| Docker | Opsional, hanya untuk jalur Docker |

## Env minimum

Salin `.env.example` ke `.env`, lalu isi 7 variabel ini. Yang lain punya default.

| Variabel | Contoh | Fungsi |
|---|---|---|
| `DATABASE_URL` | `postgresql://user:pass@localhost:5432/claude_proxy` | Koneksi PostgreSQL |
| `BETTER_AUTH_URL` | `http://localhost:8080` | URL publik aplikasi (dipakai callback Google; wajib sama dengan yang diakses browser) |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` | Penanda tangan cookie sesi |
| `GOOGLE_CLIENT_ID` | `xxx.apps.googleusercontent.com` | Dari Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | `GOCSPX-...` | Dari Google Cloud Console |
| `SUPER_ADMIN_EMAILS` | `anda@gmail.com` | Email (pisah koma) yang otomatis jadi `SUPER_ADMIN` dan `approved` saat login pertama |
| `ADMIN_KEY` | `openssl rand -hex 24` | Header `x-admin-key` untuk akses admin via API/skrip |

Variabel opsional yang sering dipakai: `PORT` (default `8080`), `CLIPROXY_AUTH_DIR` (folder `claude-*.json`; lokal pakai `./credentials`), `DEFAULT_TOKEN_LIMIT`, `OPENROUTER_API_KEY`, `DEEPSEEK_API_KEY`. Daftar lengkap ada di [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#env-vars) dan `.env.example`.

## Menjalankan (lokal)

```bash
# 1. Dependency
bun install

# 2. Database kosong, lalu env
createdb claude_proxy
cp .env.example .env          # isi 7 variabel di atas
mkdir -p credentials state

# 3. Generate Prisma client + terapkan migration
bunx prisma generate
bunx prisma migrate deploy

# 4. Jalankan
bun dev                        # dev (HMR), http://localhost:8080
# atau produksi:
bun run build && bun start
```

Cek berjalan: `curl http://localhost:8080/api/version` → `{"version":"..."}`.

## Menjalankan (Docker)

Image dibangun dari `Dockerfile` (port `8080` aplikasi, `54545` callback OAuth). `compose.yml` di repo ini adalah konfigurasi staging pemilik (Traefik + jaringan eksternal), jadi sesuaikan dulu. Versi minimal:

```bash
docker build -t claude-proxy .
docker run -d --name claude-proxy --env-file .env \
  -e CLIPROXY_AUTH_DIR=/credentials \
  -v "$PWD/credentials:/credentials" \
  -p 8080:8080 -p 54545:54545 \
  claude-proxy
```

Migration tidak dijalankan otomatis oleh image. Jalankan sekali sebelum start pertama dan setiap upgrade:

```bash
docker run --rm --env-file .env claude-proxy bunx prisma migrate deploy
```

`DATABASE_URL` harus bisa dijangkau dari dalam container (jangan pakai `localhost` kecuali `--network host`).

## Tutorial penggunaan

### 1. Login pertama

1. Buka `BETTER_AUTH_URL` → **Login dengan Google** memakai email yang ada di `SUPER_ADMIN_EMAILS`.
2. Anda otomatis menjadi `SUPER_ADMIN` dengan status `approved`. Masuk ke menu **Admin**.
3. User lain yang login akan berstatus `pending` dan harus Anda setujui di **Admin → Users**.

### 2. Hubungkan akun Claude (opsional)

1. **Admin → Accounts → Connect Account**.
2. Browser diarahkan ke claude.ai, lalu kembali ke `http://localhost:54545/callback`. **Port 54545 harus bisa dijangkau browser yang Anda pakai.** Di server remote, buka tunnel: `ssh -L 54545:localhost:54545 user@server`.
3. Credential tersimpan di `CLIPROXY_AUTH_DIR/claude-<email>.json`. Tanpa restart, proxy langsung memakainya.
4. Beberapa akun boleh dipasang bersamaan. Pin akun yang melayani lewat tombol aktifkan di daftar.

Tanpa akun Claude: isi `OPENROUTER_API_KEY` / `DEEPSEEK_API_KEY` di `.env`, atau tambahkan custom provider di **Admin → Credentials → Custom Providers**.

### 3. Beri user API key

1. Setujui user di **Admin → Users**. Tiap user mendapat token berformat `sk-cp-...` yang terlihat di halaman **Profile**-nya.
2. Atur batas pemakaian per token (`limit`) dan model yang diizinkan (allowlist) dari dashboard.
3. Alternatif tanpa Google: seed token statis lewat env `TOKENS="sk-user-alice:60000"` (format `key:limit`).

Mode reset quota (global, **Admin → Providers**): `manual` (default, admin yang reset), `auto` (ikut window Anthropic 5 jam), `daily` (tengah malam).

### 4. Pakai dari klien

**Claude Code**

```bash
export ANTHROPIC_BASE_URL=http://localhost:8080
export ANTHROPIC_AUTH_TOKEN=sk-cp-xxxxxxxx
claude
```

**curl**

```bash
curl http://localhost:8080/v1/messages \
  -H "x-api-key: sk-cp-xxxxxxxx" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"claude-sonnet-4-6","max_tokens":256,"messages":[{"role":"user","content":"Halo"}]}'
```

Autentikasi menerima `x-api-key` atau `Authorization: Bearer <token>`. Endpoint lain: `GET /v1/models`, `GET /v1/usage` (sisa quota token Anda).

### 5. Akses admin via API

```bash
curl http://localhost:8080/api/status -H "x-admin-key: $ADMIN_KEY"
```

## Troubleshooting

| Gejala | Penyebab umum |
|---|---|
| Login Google gagal `redirect_uri_mismatch` | Redirect URI di Google Console tidak sama persis dengan `<BETTER_AUTH_URL>/api/auth/callback/google` |
| Error tabel/kolom tidak ada | `prisma migrate deploy` belum dijalankan |
| `Cannot find module '.prisma/client'` | `bunx prisma generate` belum dijalankan |
| Connect Account tidak kembali | Port `54545` tidak terjangkau dari browser (lihat tunnel di atas) |
| Request `503 No provider is configured` | Belum ada akun Claude maupun provider lain |
| Request `429` | Quota token habis atau 5h utilization Anthropic ≥ `UPSTREAM_HARD_CAP_PCT` |
| "System prompt tidak dipatuhi" dari klien non-Claude-Code | Batasan upstream OAuth, bukan bug proxy. Lihat [`docs/LOGIC.md`](docs/LOGIC.md) |

## Test

```bash
bun test              # unit test (tests/unit.test.ts)
bun run test:all      # semua test (db.test.ts butuh PostgreSQL test, bukan dev/prod)
```

## Dokumentasi lanjutan

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): struktur file, schema DB, endpoint, env
- [`docs/LOGIC.md`](docs/LOGIC.md): quota, pemilihan provider/akun, translasi OpenAI
- [`docs/DEPLOY.md`](docs/DEPLOY.md): deploy dan infrastruktur
- [`CHANGELOG.md`](CHANGELOG.md): riwayat perubahan
