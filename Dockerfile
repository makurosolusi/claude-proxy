FROM oven/bun:1 AS base
WORKDIR /app

# ── Install deps ──────────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# ── Build frontend bundle ─────────────────────────────────────────────────────
FROM deps AS builder
COPY . .
RUN bun run build

# ── Runtime ───────────────────────────────────────────────────────────────────
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/node_modules    ./node_modules
COPY --from=builder /app/src             ./src
COPY --from=builder /app/dist            ./dist
COPY --from=builder /app/public          ./public
COPY --from=builder /app/package.json    ./
COPY --from=builder /app/bunfig.toml     ./
COPY --from=builder /app/tsconfig.json   ./
COPY --from=builder /app/drizzle         ./drizzle
COPY --from=builder /app/drizzle.config.ts ./

# Install envman CLI
RUN curl -fsSL https://envman.wibudev.com/install | bash

RUN mkdir -p /cliproxy-auth

EXPOSE 8080
# Temporary OAuth PKCE callback server (started only during admin/auth/login)
EXPOSE 54545

CMD ["bun", "src/index.tsx"]
