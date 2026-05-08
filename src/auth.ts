import { betterAuth } from "better-auth";
import { randomBytes } from "crypto";
import { db, users, tokens, dbUpsertUser, dbSetUserRole, dbInsertToken, slugify, ensureUniqueSlug } from "./state";
import { config } from "./config";

function generateApiKey(): string {
  return "sk-cp-" + randomBytes(24).toString("base64url");
}

export const auth = betterAuth({
  database: db,
  basePath: "/api/auth",
  baseURL: config.betterAuthUrl || `http://localhost:${config.port}`,
  ...(config.betterAuthSecret ? { secret: config.betterAuthSecret } : {}),
  socialProviders: {
    google: {
      clientId:     config.googleClientId,
      clientSecret: config.googleClientSecret,
    },
  },
  emailAndPassword: {
    enabled: false,
  },
  trustedOrigins: [
    config.betterAuthUrl || `http://localhost:${config.port}`,
  ],
  session: {
    expiresIn: 30 * 24 * 60 * 60,
    updateAge:     24 * 60 * 60,
  },
  databaseHooks: {
    user: {
      create: {
        after: async (baUser) => {
          const email = baUser.email.toLowerCase();
          const role = config.superAdminEmails.has(email) ? "SUPER_ADMIN" : "USER";
          // Sync to our custom users table (slug-based IDs, description, role)
          const existing = Object.values(users).find(u => u.email?.toLowerCase() === email);
          if (existing) {
            if (existing.role !== role && role === "SUPER_ADMIN") dbSetUserRole(existing.id, "SUPER_ADMIN");
            return;
          }
          const base = slugify((baUser.name as string) || baUser.email.split("@")[0]);
          const id = ensureUniqueSlug(base, users);
          const entry = {
            id,
            name: (baUser.name as string) || baUser.email.split("@")[0],
            email: baUser.email,
            description: "",
            created_at: Date.now(),
            role,
          } as const;
          users[id] = entry;
          dbUpsertUser(entry);

          // Auto-create one API token for the new user (paused until admin activates)
          const tokenKey = generateApiKey();
          const tokenEntry: import("./types").TokenEntry = {
            limit: config.defaultTokenLimit,
            window: config.windowMs,
            used: 0,
            windowStart: Date.now(),
            paused: true,
            dynamic: true,
            mode: "inherit",
            provider: "inherit",
            name: entry.name,
            user_id: id,
          };
          tokens[tokenKey] = tokenEntry;
          dbInsertToken(tokenKey, tokenEntry);
        },
      },
    },
  },
});
