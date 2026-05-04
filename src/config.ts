function resolvePort(): number {
  const argv = process.argv;
  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === "--port" || argv[i] === "-p") && argv[i + 1]) {
      const p = parseInt(argv[i + 1]);
      if (!isNaN(p)) return p;
    }
    const m = argv[i].match(/^--port=(\d+)$/);
    if (m) return parseInt(m[1]);
  }
  return parseInt(process.env.PORT || "8080");
}

export const config = {
  adminKey:        process.env.ADMIN_KEY          || "",
  adminUsername:   process.env.ADMIN_USERNAME     || "",
  adminPassword:   process.env.ADMIN_PASSWORD     || "",
  windowMs:        parseInt(process.env.WINDOW_MS              || "18000000"),
  capPct:          parseFloat(process.env.UPSTREAM_HARD_CAP_PCT || "95"),
  pollMs:          parseInt(process.env.UPSTREAM_POLL_MS        || "60000"),
  authDir:         process.env.CLIPROXY_AUTH_DIR  || "/credentials",
  dbFile:          process.env.DB_FILE            || "/state/proxy.db",
  tokensEnv:       process.env.TOKENS             || "",
  port:            resolvePort(),
  anthropicUrl:    process.env.ANTHROPIC_API_URL  || "https://api.anthropic.com",
  deepseekApiKey:  process.env.DEEPSEEK_API_KEY   || "",
  deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL  || "https://api.deepseek.com/anthropic",
  deepseekModel:   process.env.DEEPSEEK_MODEL     || "deepseek-v4-pro[1m]",
} as const;
