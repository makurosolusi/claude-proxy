import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { randomBytes } from "crypto";
import { prisma } from "./prisma";
import { users, tokens, dbUpsertUser, dbSetUserRole, dbSetUserStatus, dbInsertToken, slugify, ensureUniqueSlug } from "./state";
import { config } from "./config";

function generateApiKey(): string {
  return "sk-cp-" + randomBytes(24).toString("base64url");
}

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  basePath: "/api/auth",
  baseURL: config.betterAuthUrl || `http://localhost:${config.port}`,
  ...(config.betterAuthSecret ? { secret: config.betterAuthSecret } : {}),
  socialProviders: {
    google: {
      clientId:     config.googleClientId,
      clientSecret: config.googleClientSecret,
    },
  },
  emailAndPassword: { enabled: false },
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
          const isSuperAdmin = config.superAdminEmails.has(email);
          const role  = isSuperAdmin ? "SUPER_ADMIN" : "USER";
          const status = isSuperAdmin ? "approved" : "pending";
          const existing = Object.values(users).find(u => u.email?.toLowerCase() === email);
          if (existing) {
            if (existing.role !== role && role === "SUPER_ADMIN") await dbSetUserRole(existing.id, "SUPER_ADMIN");
            if (existing.status !== "approved" && isSuperAdmin) await dbSetUserStatus(existing.id, "approved");
            return;
          }
          const base = slugify((baUser.name as string) || baUser.email.split("@")[0]);
          const id   = ensureUniqueSlug(base, users);
          const entry = {
            id,
            name: (baUser.name as string) || baUser.email.split("@")[0],
            email: baUser.email,
            description: "",
            created_at: Date.now(),
            role,
            status,
          } as const;
          users[id] = entry;
          await dbUpsertUser(entry);

          const tokenKey    = generateApiKey();
          const tokenEntry: import("./types").TokenEntry = {
            limit: config.defaultTokenLimit,
            window: config.windowMs,
            used: 0, windowStart: Date.now(),
            paused: true, dynamic: true, mode: "inherit", provider: "inherit",
            user_id: id,
            label: "", description: "", pinned_model: "", allowed_models: [], output_type: "anthropic",
            last_reset: 0,
          };
          tokens[tokenKey] = tokenEntry;
          await dbInsertToken(tokenKey, tokenEntry);
        },
      },
    },
  },
});
