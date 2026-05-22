# Playwright + OAuth-only Login Pattern

> **Problem**: Aplikasi login via OAuth (Google/GitHub/Microsoft) saja. Playwright
> tidak bisa otomasi OAuth flow — provider deteksi headless browser, ada captcha,
> redirect lintas domain. E2E test atau Playwright MCP jadi mentok.
>
> **Solusi**: Dev-only backdoor endpoint yang langsung create session untuk email
> apapun, di-guard dengan secret. Production tidak pernah set secret → endpoint
> mati. Combined dengan MCP tool agar AI agent otomatis tahu cara pakainya.

Dokumen ini agnostic terhadap framework — pola dasarnya bisa dipakai di
Node.js/Bun/Deno + Express/Fastify/Hono/Elysia + Better Auth/Lucia/NextAuth.

---

## Konsep

### Threat model

| Aktor | Bisa apa kalau secret bocor |
|---|---|
| `MCP_SECRET` (read-only debug) | Inspect state — read DB, view logs |
| `DEV_LOGIN_SECRET` (impersonation) | **Jadi user manapun**, termasuk admin |

`DEV_LOGIN_SECRET` jauh lebih powerful. Pisahkan dari secret lain.

### Production safety

3 lapis:
1. **Env-presence guard**: endpoint 404 kalau env var tidak ada. Production NEVER set var ini.
2. **Header match**: caller harus kirim header dengan value yang sama.
3. **Deploy preflight scan**: refuse deploy kalau pattern secret muncul di production env config.

Plus konvensi:
- Secret format dengan prefix khusus (`devlogin-`) → mudah grep awareness
- Dokumentasi explicit: "JANGAN PERNAH set di production"

---

## 1. Backend endpoint (verbatim, sesuaikan dengan auth library)

### Pseudocode framework-agnostic

```ts
// POST /api/dev/login
async function handleDevLogin(req: Request): Promise<Response> {
  // Layer 1: env-presence guard
  const secret = process.env.DEV_LOGIN_SECRET;
  if (!secret) return new Response("Not found", { status: 404 });

  // Layer 2: header match
  if (req.headers.get("x-dev-secret") !== secret) {
    return new Response("Forbidden", { status: 403 });
  }
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const { email, name } = await req.json();
  if (!email) return Response.json({ error: "email required" }, { status: 400 });

  // 1. Find or create the user in your auth system's user table
  let user = await findUserByEmail(email);
  if (!user) {
    user = await createUser({ email, name: name || email.split("@")[0] });
  }

  // 2. Create a session for that user
  const session = await createSession(user.id);
  // session = { token, expiresAt, ... }

  // 3. Build the session cookie. Format MUST match what your auth lib
  //    expects when it parses incoming cookies (e.g. HMAC-signed value).
  const cookieValue = await signSessionCookie(session.token, secret);
  const cookieName = "your-auth.session_token"; // match your auth lib
  const isHttps = baseUrl.startsWith("https://");

  // 4. Return JSON + Set-Cookie. JSON contains cookie object ready for
  //    Playwright's addCookies(), so callers don't have to parse Set-Cookie.
  return new Response(JSON.stringify({
    ok: true,
    user: { id: user.id, email: user.email, name: user.name },
    cookie: {
      name:     cookieName,
      value:    cookieValue,
      domain:   new URL(baseUrl).hostname,
      path:     "/",
      httpOnly: true,
      secure:   isHttps,
      sameSite: "Lax",
      expires:  Math.floor(session.expiresAt.getTime() / 1000),
    },
  }), {
    headers: {
      "content-type": "application/json",
      "set-cookie": `${cookieName}=${cookieValue}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${isHttps ? "; Secure" : ""}`,
    },
  });
}
```

### Auth-library-specific notes

**Better Auth**: cookie signed dengan HMAC-SHA256, format `${token}.${base64(sig)}` URL-encoded. Cookie name pattern `${prefix}.session_token` (default `better-auth`). Pada HTTPS prefix dengan `__Secure-`. Lihat `better-call/dist/crypto.mjs` di node_modules untuk format pasti.

**NextAuth/Auth.js**: gunakan `encode()` dari `next-auth/jwt`. Cookie name `next-auth.session-token` (HTTPS: `__Secure-...`).

**Lucia**: pakai `lucia.createSession(userId)` lalu `lucia.createSessionCookie(session.id)` untuk dapatkan cookie attributes ready-to-set.

**Custom JWT**: HMAC-SHA256 atau JWE dengan secret yang sama dengan production auth setup.

### Auto-approve dev users

Kalau aplikasi punya status user (pending/approved/blocked), set ke `approved` saat create di dev login. E2E test tidak boleh ke-blok flow approval.

---

## 2. Helper script CLI

`scripts/dev-login.ts` — call endpoint dari command line, output JSON siap pakai Playwright:

```ts
#!/usr/bin/env bun
// Usage: bun scripts/dev-login.ts <email> [base_url]

const email   = process.argv[2];
const baseArg = process.argv[3] || "http://localhost:3000";
const secret  = process.env.DEV_LOGIN_SECRET;

if (!email)  { console.error("Usage: bun scripts/dev-login.ts <email> [base_url]"); process.exit(2); }
if (!secret) { console.error("DEV_LOGIN_SECRET env var is required"); process.exit(2); }

const r = await fetch(new URL("/api/dev/login", baseArg).toString(), {
  method:  "POST",
  headers: { "content-type": "application/json", "x-dev-secret": secret },
  body:    JSON.stringify({ email }),
});

if (!r.ok) { console.error(`HTTP ${r.status}: ${await r.text()}`); process.exit(1); }

const data = await r.json();

console.log(JSON.stringify({
  user: data.user,
  cookies: [{
    name:     data.cookie.name,
    value:    data.cookie.value,
    domain:   data.cookie.domain,
    path:     data.cookie.path,
    httpOnly: data.cookie.httpOnly,
    secure:   data.cookie.secure,
    sameSite: data.cookie.sameSite,
    expires:  data.cookie.expires,
  }],
  cookie_header: `${data.cookie.name}=${data.cookie.value}`,
}, null, 2));
```

### Cara pakai

```bash
# Dari CLI manual
DEV_LOGIN_SECRET=devlogin-xxx bun scripts/dev-login.ts test@example.com

# Output:
# {
#   "user": { "id": "...", "email": "test@example.com", "name": "test" },
#   "cookies": [ { ... cookie object siap diumpan ke Playwright ... } ],
#   "cookie_header": "your-auth.session_token=..."
# }
```

---

## 3. Playwright integration

### Pakai langsung di Playwright test

```ts
import { test, chromium } from "@playwright/test";
import { execSync } from "child_process";

test.beforeEach(async ({ context }) => {
  const out = execSync(`bun scripts/dev-login.ts test@example.com`, {
    env: { ...process.env, DEV_LOGIN_SECRET: process.env.DEV_LOGIN_SECRET },
  }).toString();
  const { cookies } = JSON.parse(out);
  await context.addCookies(cookies);
});

test("dashboard loads", async ({ page }) => {
  await page.goto("/");
  // user already logged in, no OAuth dance needed
});
```

### Pakai dengan Playwright MCP (untuk AI agent)

```ts
// 1. Agent panggil dev_login MCP tool
const result = await mcp__proxy_dev__dev_login({ email: "test@example.com" });
// result.playwright_cookies = [ { name, value, ... } ]

// 2. Inject cookie via browser_run_code_unsafe
await mcp__playwright__browser_run_code_unsafe({
  code: `async (page) => {
    await page.context().addCookies(${JSON.stringify(result.playwright_cookies)});
  }`,
});

// 3. Navigate normal — sudah authenticated
await mcp__playwright__browser_navigate({ url: "http://localhost:3000/" });
```

---

## 4. MCP server integration (untuk AI agent)

Agent (Claude/copilot/dll) baca **deskripsi MCP tool** dari system prompt.
Deskripsi yang baik = agent otomatis pakai tool yang tepat tanpa diberitahu.

### Tool definition (JSON-RPC 2.0 MCP server)

```ts
{
  name: "dev_login",
  description:
    "Login as a user via dev backdoor (skips OAuth). Returns " +
    "Playwright-ready cookies. CALL THIS BEFORE " +
    "mcp__playwright__browser_navigate to any protected route — " +
    "OAuth providers cannot be automated by Playwright. " +
    "Auto-creates the user with approved status if not exists. " +
    "Requires DEV_LOGIN_SECRET env var (set in .mcp.json).",
  inputSchema: {
    type: "object",
    properties: {
      email: { type: "string", description: "Email to login as (auto-created if not exists)" },
      name:  { type: "string", description: "Optional display name" },
    },
    required: ["email"],
  },
}
```

**Kuncinya**: kalimat `CALL THIS BEFORE mcp__playwright__browser_navigate` —
direktif eksplisit yang membuat agent connect titik-titiknya. Tanpa kalimat
ini, agent mungkin coba `browser_navigate` langsung dan dapat halaman login.

### Tool handler

```ts
async function toolDevLogin(args: { email: string; name?: string }) {
  if (!DEV_LOGIN_SECRET) {
    return { error: "DEV_LOGIN_SECRET not configured in MCP env." };
  }
  const res = await fetch(`${BASE_URL}/api/dev/login`, {
    method:  "POST",
    headers: { "content-type": "application/json", "x-dev-secret": DEV_LOGIN_SECRET },
    body:    JSON.stringify({ email: args.email, name: args.name }),
  });
  if (!res.ok) return { error: `HTTP ${res.status}`, body: (await res.text()).slice(0, 200) };
  const data = await res.json();
  return {
    user: data.user,
    playwright_cookies: [data.cookie],
    cookie_header: `${data.cookie.name}=${data.cookie.value}`,
    hint: "Next: inject playwright_cookies via browser_run_code_unsafe → page.context().addCookies(...), then browser_navigate.",
  };
}
```

### .mcp.json configuration

```json
{
  "mcpServers": {
    "your-app-dev": {
      "command": "bun",
      "args": ["run", "scripts/mcp/dev.ts"],
      "env": {
        "BASE_URL":         "http://localhost:3000",
        "DEV_LOGIN_SECRET": "${DEV_LOGIN_SECRET}"
      }
    }
  }
}
```

---

## 5. Deployment safety

### Preflight scan (block production deploy)

Di deploy script, scan production env config untuk secret pattern:

```ts
function preflightScan(productionEnv: Record<string, string>) {
  const forbidden = [
    { key: "DEV_LOGIN_SECRET", reason: "Impersonation backdoor must never be in production" },
  ];
  for (const { key, reason } of forbidden) {
    if (productionEnv[key]) {
      throw new Error(`PREFLIGHT BLOCKED: ${key} found in production env. ${reason}`);
    }
  }
}
```

### Secret format convention

Pakai prefix yang grep-friendly:
- `devlogin-` untuk DEV_LOGIN_SECRET → `grep "devlogin-" production-env.yaml` instant detection
- Tidak pakai prefix generic seperti `secret-` yang juga muncul di lain tempat

```bash
# Generate secret
DEV_LOGIN_SECRET=devlogin-$(openssl rand -hex 16)
```

### Documentation di repo

Tambahkan ke `CLAUDE.md` / `README.md` / `CONTRIBUTING.md`:

```markdown
## Dev Login (Playwright / E2E Testing)

Login normal cuma via OAuth — tidak bisa diotomasi. Untuk E2E pakai
backdoor: `POST /api/dev/login`.

**JANGAN PERNAH** set `DEV_LOGIN_SECRET` di production environment.
Production tidak punya var ini → endpoint return 404.

Lihat `docs/PLAYWRIGHT-OAUTH-PATTERN.md` untuk detail.
```

---

## 6. Checklist saat adopsi di project baru

- [ ] Identifikasi cookie format auth library yang dipakai (name + signing)
- [ ] Implement `POST /api/dev/login` dengan dua-layer guard (env presence + header)
- [ ] Tulis `scripts/dev-login.ts` helper CLI
- [ ] Tambah MCP tool `dev_login` dengan deskripsi direktif `CALL THIS BEFORE...`
- [ ] Set `DEV_LOGIN_SECRET` di `.env` local dan staging environment
- [ ] **VERIFIKASI** `DEV_LOGIN_SECRET` TIDAK ADA di production env
- [ ] Tambah preflight scan di deploy pipeline
- [ ] Document di `CLAUDE.md` / `README.md`
- [ ] Smoke test: curl endpoint tanpa secret = 404, dengan secret = 200 + cookie
- [ ] Smoke test: pakai cookie di Playwright, akses route protected = 200

---

## 7. Common pitfalls

### Cookie tidak diterima oleh `auth.api.getSession`
**Cause**: format cookie tidak match (signing salah, name salah).  
**Fix**: trace cara auth lib parse cookie (biasanya di `getSession`/`getSessionCookie`). Lihat library source code di `node_modules` untuk format pasti.

### Endpoint return 404 padahal env sudah set
**Cause**: server tidak di-restart, hot-reload kadang miss route addition.  
**Fix**: restart dev server / redeploy staging container.

### MCP tool tidak muncul di agent
**Cause**: MCP server tidak load env var, atau Claude Code session belum direstart.  
**Fix**: Cek `.mcp.json` punya `DEV_LOGIN_SECRET` di `env`. Restart Claude Code session.

### Agent tidak otomatis pakai `dev_login` sebelum `browser_navigate`
**Cause**: deskripsi tool kurang direktif.  
**Fix**: pastikan deskripsi mengandung kalimat eksplisit "CALL THIS BEFORE browser_navigate to protected route" + alasan ("OAuth cannot be automated").

### Cookie inject berhasil tapi tetap dianggap unauthenticated
**Cause**: domain cookie mismatch (mis. cookie `domain=localhost` tapi navigate ke `127.0.0.1`).  
**Fix**: pastikan `domain` di cookie sama dengan host yang di-navigate.

---

## 8. Variasi pola

### Multiple environments share single secret
Tidak disarankan. Generate secret berbeda per environment supaya rotation per-env.

### Login as admin specifically
Tambah argumen `role` ke endpoint, dengan whitelist allowed roles. Atau biarkan
endpoint detect dari email (mis. email di `SUPER_ADMIN_EMAILS` → grant admin
role saat auto-create).

### Stateless mode (tanpa create user)
Kalau cuma butuh session untuk user yang sudah ada, skip step "find or create"
dan return 404 kalau email tidak terdaftar.

### Time-limited session
Set `expiresIn` ke nilai pendek (mis. 1 jam) supaya cookie test cepat expire.
Mengurangi blast radius kalau secret bocor.

---

## Referensi

- OAuth threat model: [draft-ietf-oauth-security-topics](https://datatracker.ietf.org/doc/draft-ietf-oauth-security-topics/)
- Playwright auth: [playwright.dev/docs/auth](https://playwright.dev/docs/auth) (storageState pattern)
- MCP spec: [modelcontextprotocol.io](https://modelcontextprotocol.io)
