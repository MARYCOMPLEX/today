import { betterAuth } from "better-auth/minimal";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import { authSchema } from "./schema";
import type { Env } from "./types";

export function createAuth(env: Env, origin: string) {
  return betterAuth({
    database: drizzleAdapter(drizzle(env.DB, { schema: authSchema }), { provider: "sqlite", schema: authSchema }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: origin,
    basePath: "/api/auth",
    trustedOrigins: [origin],
    emailAndPassword: { enabled: true, minPasswordLength: 12, maxPasswordLength: 128 },
    advanced: { cookiePrefix: "wx_notify", useSecureCookies: origin.startsWith("https://") },
  });
}
