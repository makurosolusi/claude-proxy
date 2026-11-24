# claude-proxy

A proxy that shares one Claude Max (OAuth) account across many users through per-user API keys, with quota management, an admin dashboard, and fallback to other providers (OpenRouter, DeepSeek, or custom).

- Clients (Claude Code, the Anthropic SDK, curl) point at this proxy and use an `sk-cp-...` API key.
- Admins manage users, quotas, allowed models, and Claude accounts from a web dashboard.
- A Claude account is **optional**: without Claude credentials the proxy still runs through OpenRouter, DeepSeek, or a custom provider.

## Requirements

| Requirement | Notes |
|---|---|
| [Bun](https://bun.sh) ≥ 1.3 | Runtime and package manager |
| PostgreSQL ≥ 14 | Primary storage (via Prisma) |
| Google OAuth client | Dashboard login is Google-only. Create one in the [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → *OAuth client ID* → *Web application*. Authorized redirect URI: `<BETTER_AUTH_URL>/api/auth/callback/google` |
| Claude Max/Pro account | Optional. Alternatively provide an OpenRouter or DeepSeek API key |
| Docker | Optional, only for the Docker route |

## Minimum environment

Copy `.env.example` to `.env` and fill in these 7 variables. Everything else has a default.

| Variable | Example | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgresql://user:pass@localhost:5432/claude_proxy` | PostgreSQL connection |
| `BETTER_AUTH_URL` | `http://localhost:8080` | Public URL of the app (used for the Google callback; must match what the browser visits) |
| `BETTER_AUTH_SECRET` | output of `openssl rand -base64 32` | Signs session cookies |
| `GOOGLE_CLIENT_ID` | `xxx.apps.googleusercontent.com` | From the Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | `GOCSPX-...` | From the Google Cloud Console |
| `SUPER_ADMIN_EMAILS` | `you@gmail.com` | Comma-separated emails that become `SUPER_ADMIN` and `approved` on first login |
| `ADMIN_KEY` | output of `openssl rand -hex 24` | `x-admin-key` header for admin access via API or scripts |

Commonly used optional variables: `PORT` (default `8080`), `CLIPROXY_AUTH_DIR` (folder holding `claude-*.json`; use `./credentials` locally), `DEFAULT_TOKEN_LIMIT`, `OPENROUTER_API_KEY`, `DEEPSEEK_API_KEY`. The full list is in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#env-vars) and `.env.example`.

## Run locally

```bash
# 1. Dependencies
bun install

# 2. Empty database, then env
createdb claude_proxy
cp .env.example .env          # fill in the 7 variables above
mkdir -p credentials state

# 3. Generate the Prisma client and apply migrations
bunx prisma generate
bunx prisma migrate deploy

# 4. Start
bun dev                        # development (HMR), http://localhost:8080
# or production:
bun run build && bun start
```

Check it is running: `curl http://localhost:8080/api/version` → `{"version":"..."}`.

## Run with Docker

The image is built from the `Dockerfile` (app on port `8080`, OAuth callback on `54545`). The `compose.yml` in this repo is the owner's staging setup (Traefik plus external networks), so adapt it before use. Minimal version:

```bash
docker build -t claude-proxy .
docker run -d --name claude-proxy --env-file .env \
  -e CLIPROXY_AUTH_DIR=/credentials \
  -v "$PWD/credentials:/credentials" \
  -p 8080:8080 -p 54545:54545 \
  claude-proxy
```

The image does not run migrations on its own. Run them once before the first start and on every upgrade:

```bash
docker run --rm --env-file .env claude-proxy bunx prisma migrate deploy
```

`DATABASE_URL` must be reachable from inside the container (do not use `localhost` unless you pass `--network host`).

## Usage guide

### 1. First login

1. Open `BETTER_AUTH_URL` and choose **Sign in with Google** using an email listed in `SUPER_ADMIN_EMAILS`.
2. You become `SUPER_ADMIN` with status `approved`. Open the **Admin** menu.
3. Other users who sign in start as `pending`; approve them under **Admin → Users**.

### 2. Connect a Claude account (optional)

1. **Admin → Accounts → Connect Account**.
2. The browser goes to claude.ai and returns to `http://localhost:54545/callback`. **Port 54545 must be reachable from the browser you use.** On a remote server, open a tunnel: `ssh -L 54545:localhost:54545 user@server`.
3. The credential is saved to `CLIPROXY_AUTH_DIR/claude-<email>.json`. The proxy uses it immediately, no restart needed.
4. Several accounts can coexist. Pin the serving account from the list.

Without a Claude account: set `OPENROUTER_API_KEY` / `DEEPSEEK_API_KEY` in `.env`, or add a custom provider under **Admin → Credentials → Custom Providers**.

### 3. Give users API keys

1. Approve users under **Admin → Users**. Each user gets an `sk-cp-...` token, visible on their **Profile** page.
2. Set a per-token usage `limit` and the allowed models (allowlist) from the dashboard.
3. Alternative without Google: seed static tokens with the `TOKENS` env var, e.g. `TOKENS="sk-user-alice:60000"` (format `key:limit`).

Quota reset mode (global, **Admin → Providers**): `manual` (default, admin resets), `auto` (follows the Anthropic 5-hour window), `daily` (midnight).

### 4. Use it from a client

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
  -d '{"model":"claude-sonnet-4-6","max_tokens":256,"messages":[{"role":"user","content":"Hello"}]}'
```

Authentication accepts `x-api-key` or `Authorization: Bearer <token>`. Other endpoints: `GET /v1/models`, `GET /v1/usage` (remaining quota for your token).

### 5. Admin access via API

```bash
curl http://localhost:8080/api/status -H "x-admin-key: $ADMIN_KEY"
```

## Troubleshooting

| Symptom | Common cause |
|---|---|
| Google login fails with `redirect_uri_mismatch` | The redirect URI in the Google Console does not exactly match `<BETTER_AUTH_URL>/api/auth/callback/google` |
| Table or column does not exist | `prisma migrate deploy` has not been run |
| `Cannot find module '.prisma/client'` | `bunx prisma generate` has not been run |
| Connect Account never returns | Port `54545` is not reachable from the browser (see the tunnel above) |
| Request returns `503 No provider is configured` | No Claude account and no other provider is set up |
| Request returns `429` | Token quota exhausted, or Anthropic 5h utilization ≥ `UPSTREAM_HARD_CAP_PCT` |
| "System prompt is ignored" from a non-Claude-Code client | Upstream OAuth limitation, not a proxy bug. See [`docs/LOGIC.md`](docs/LOGIC.md) |

## Tests

```bash
bun test              # unit tests (tests/unit.test.ts)
bun run test:all      # all tests (db.test.ts needs a test PostgreSQL, never dev/prod)
```

## Further documentation

Note: the documents below are written in Indonesian.

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): file structure, DB schema, endpoints, env vars
- [`docs/LOGIC.md`](docs/LOGIC.md): quota, provider and account selection, OpenAI translation
- [`docs/DEPLOY.md`](docs/DEPLOY.md): deployment and infrastructure
- [`CHANGELOG.md`](CHANGELOG.md): change history
