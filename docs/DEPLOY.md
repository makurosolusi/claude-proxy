# Deploy & Scripts

## Scripts

| Script | Keterangan |
|---|---|
| `bun dev` | Dev server dengan HMR (`bun --hot src/index.tsx`) |
| `bun run build:css` | Generate `src/style.css` dari Tailwind source |
| `bun run watch:css` | Watch + rebuild CSS on changes |
| `bun run build` | Production build ke `dist/` (auto runs build:css dulu) |
| `bun start` | Production server (`NODE_ENV=production`) |

## Dev

```bash
# Terminal 1 — CSS watcher
bun run watch:css

# Terminal 2 — Bun dev server dengan HMR
bun dev
```

## Production

```bash
bun run build
bun start
```

## Infrastructure (frpc tunnel)

Project jalan langsung di host, bukan di Docker. `compose.yml` di root hanya berisi frpc container yang tunnel domain publik → `host.docker.internal:8080`.

- Domain: `claude-local.wibudev.com`
- Port lokal: `8080`
- SQLite db: `./state/proxy.db`
- OAuth credentials: `CLIPROXY_AUTH_DIR` (default `/cliproxy-auth`)
