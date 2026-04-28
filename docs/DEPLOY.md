# Deploy & Scripts

## Scripts (local / dev)

| Script | Keterangan |
|---|---|
| `bun dev` | Dev server dengan HMR (`bun --hot src/index.tsx`) |
| `bun run build` | Production build frontend bundle ke `dist/` |
| `bun start` | Production server (`NODE_ENV=production`) |

## Dev

```bash
# Terminal 1 — CSS watcher (opsional, Bun bundler handles CSS automatically)
# bun run watch:css

# Terminal 2 — Bun dev server dengan HMR
bun dev

# Dev dengan env file + custom port
dotenv -e .env.dev -- bun dev -p 8081
```

## Production (bare metal / host)

```bash
bun run build
bun start
```

## Production (Docker)

```bash
# 1. Siapkan .env dari template
cp .env.example .env
# Edit .env — isi ADMIN_PASSWORD, TOKENS, dll

# 2. Buat direktori untuk volumes
mkdir -p state credentials

# 3. Build + start
docker compose up -d --build

# 4. Lihat logs
docker compose logs -f proxy

# 5. Rebuild setelah code change
docker compose up -d --build proxy
```

### Volume layout

| Host path | Container path | Isi |
|---|---|---|
| `./state` | `/app/state` | SQLite DB (`proxy.db`) |
| `./credentials` | `/cliproxy-auth` | OAuth credential files (`claude-*.json`) |

### Port mapping

| Host | Container | Keterangan |
|---|---|---|
| `8080` | `8080` | Main proxy server |
| `54545` | `54545` | OAuth PKCE callback (hanya aktif saat admin login) |

**Penting:** Port 54545 harus reachable dari browser yang melakukan OAuth login. Jika proxy di server remote, browser tidak bisa redirect ke `localhost:54545` — gunakan SSH tunnel atau akses proxy dari localhost.

## Infrastructure (Traefik)

Routing lewat Traefik yang sudah berjalan di infrastruktur via `public-net` (external network).

- Domain: `claude-local.wibudev.com` (HTTPS otomatis via letsencrypt)
- Traefik reach `proxy:8080` via `public-net` — port 8080 tidak di-expose ke host
- Port 54545 tetap direct bind (OAuth PKCE callback, harus accessible dari browser)
- SQLite db: `./state/proxy.db` (bind mount)
- OAuth credentials: `./credentials/` (bind mount → `/cliproxy-auth` dalam container)

## OAuth Credential Setup (tanpa Claude Code CLI)

```bash
# 1. Buka admin panel → Accounts → Connect Account
# 2. Browser redirect ke claude.ai → authorize
# 3. Callback diterima di localhost:54545 → credential disimpan ke ./credentials/
# 4. Proxy langsung pakai credential baru — tidak perlu restart
```
