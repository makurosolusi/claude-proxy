export const config = {
  upstream:        process.env.UPSTREAM          || "",
  upstreamKey:     process.env.UPSTREAM_KEY      || "",
  adminKey:        process.env.ADMIN_KEY          || "",
  adminUsername:   process.env.ADMIN_USERNAME     || "",
  adminPassword:   process.env.ADMIN_PASSWORD     || "",
  windowMs:        parseInt(process.env.WINDOW_MS              || "18000000"),
  capPct:          parseFloat(process.env.UPSTREAM_HARD_CAP_PCT || "95"),
  pollMs:          parseInt(process.env.UPSTREAM_POLL_MS        || "60000"),
  authDir:         process.env.CLIPROXY_AUTH_DIR  || "/cliproxy-auth",
  dbFile:          process.env.DB_FILE            || "/state/proxy.db",
  tokensEnv:       process.env.TOKENS             || "",
  port:            parseInt(process.env.PORT      || "8080"),
  // Direct mode: bypass cliproxy, talk to Anthropic directly
  upstreamMode:    (process.env.UPSTREAM_MODE     || "cliproxy") as "cliproxy" | "direct",
  anthropicUrl:    process.env.ANTHROPIC_API_URL  || "https://api.anthropic.com",
  shadowDirect:    process.env.SHADOW_DIRECT      === "true",
} as const;
