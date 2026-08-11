import type { Env, SessionUser } from "./types";

export async function userRole(env: Env, userId: string): Promise<"user" | "admin"> {
  const row = await env.DB.prepare("SELECT role FROM user_profile WHERE user_id = ?").bind(userId).first<{ role: "user" | "admin" }>();
  return row?.role ?? "user";
}

export async function sessionUser(env: Env, origin: string, headers: Headers): Promise<SessionUser | null> {
  const { createAuth } = await import("./auth");
  const result = await createAuth(env, origin).api.getSession({ headers });
  return result?.user ? { id: result.user.id, email: result.user.email, name: result.user.name } : null;
}

export function gatewayStub(env: Env): DurableObjectStub {
  return env.GATEWAY.get(env.GATEWAY.idFromName("gateway"));
}
