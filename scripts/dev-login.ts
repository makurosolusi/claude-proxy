#!/usr/bin/env bun
// dev-login: login as any user via /api/dev/login (dev backdoor) and output
// a Playwright-ready cookie object for `page.context().addCookies([...])`.
//
// Usage:
//   bun scripts/dev-login.ts <email> [base_url]
//   DEV_LOGIN_SECRET=... bun scripts/dev-login.ts test@example.com
//   DEV_LOGIN_SECRET=... bun scripts/dev-login.ts test@example.com https://claude-proxy.wibudev.com
//
// Output (stdout): single JSON object with `cookie` field — an array element
// you can pass directly to Playwright's addCookies():
//   [ { name, value, domain, path, httpOnly, secure, sameSite, expires } ]

const email   = process.argv[2];
const baseArg = process.argv[3] || "http://localhost:3000";
const secret  = process.env.DEV_LOGIN_SECRET;

if (!email) {
  console.error("Usage: bun scripts/dev-login.ts <email> [base_url]");
  process.exit(2);
}
if (!secret) {
  console.error("DEV_LOGIN_SECRET env var is required");
  process.exit(2);
}

const url = new URL("/api/dev/login", baseArg).toString();
const r = await fetch(url, {
  method:  "POST",
  headers: { "content-type": "application/json", "x-dev-secret": secret },
  body:    JSON.stringify({ email }),
});

if (!r.ok) {
  console.error(`dev-login failed: HTTP ${r.status}`);
  console.error(await r.text());
  process.exit(1);
}

const data = await r.json() as {
  ok: boolean;
  user: { id: string; email: string; name: string; role: string; status: string };
  cookie: {
    name: string; value: string; domain: string; path: string;
    httpOnly: boolean; secure: boolean; sameSite: string; expires: number;
  };
};

// Playwright addCookies expects sameSite as "Strict" | "Lax" | "None"
const playwrightCookies = [{
  name:     data.cookie.name,
  value:    data.cookie.value,
  domain:   data.cookie.domain,
  path:     data.cookie.path,
  httpOnly: data.cookie.httpOnly,
  secure:   data.cookie.secure,
  sameSite: data.cookie.sameSite,
  expires:  data.cookie.expires,
}];

console.log(JSON.stringify({
  user:    data.user,
  cookies: playwrightCookies,
  // Convenience: ready-to-use Cookie header for plain curl/fetch
  cookie_header: `${data.cookie.name}=${data.cookie.value}`,
}, null, 2));
