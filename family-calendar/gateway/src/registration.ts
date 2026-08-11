import { createAuth } from "./auth";
import { sha256Hex } from "./crypto";
import { passwordProblem, validChinaPhone } from "./password";
import type { Env } from "./types";

export interface RegistrationInput { email: string; password: string; phone?: string; invitationCode: string; origin: string }

export async function registerUser(env: Env, input: RegistrationInput): Promise<Response> {
  const email = input.email.trim().toLowerCase();
  const phone = input.phone?.trim() || null;
  if (!/^\S+@\S+\.\S+$/.test(email)) return Response.json({ error: "请输入有效邮箱" }, { status: 400 });
  if (phone && !validChinaPhone(phone)) return Response.json({ error: "手机号必须是中国大陆 11 位手机号" }, { status: 400 });
  const weak = passwordProblem(input.password, email, phone);
  if (weak) return Response.json({ error: weak }, { status: 400 });
  if (phone) {
    const existingPhone = await env.DB.prepare("SELECT user_id FROM user_profile WHERE phone = ?").bind(phone).first();
    if (existingPhone) return Response.json({ error: "该手机号已被使用" }, { status: 409 });
  }
  const tokenHash = await sha256Hex(input.invitationCode.trim());
  const invite = await env.DB.prepare(`SELECT id, role, email FROM invitation
    WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ?`)
    .bind(tokenHash, Date.now()).first<{ id: string; role: "user" | "admin"; email: string | null }>();
  if (!invite || (invite.email && invite.email.toLowerCase() !== email)) {
    return Response.json({ error: "邀请码无效、已使用或已过期" }, { status: 400 });
  }

  const request = new Request(`${input.origin}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: input.origin },
    body: JSON.stringify({ name: email.split("@")[0], email, password: input.password }),
  });
  const response = await createAuth(env, input.origin).handler(request);
  if (!response.ok) return response;
  const body = await response.clone().json() as { user?: { id?: string } };
  const userId = body.user?.id;
  if (!userId) return Response.json({ error: "注册响应缺少用户 ID" }, { status: 500 });
  const now = Date.now();
  const results = await env.DB.batch([
    env.DB.prepare("UPDATE invitation SET consumed_at = ?, consumed_by = ? WHERE id = ? AND consumed_at IS NULL").bind(now, userId, invite.id),
    env.DB.prepare("INSERT INTO user_profile (user_id, phone, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind(userId, phone, invite.role, now, now),
    env.DB.prepare("INSERT INTO notification_settings (user_id, quiet_start_minutes, quiet_end_minutes, updated_at) VALUES (?, 0, 420, ?)").bind(userId, now),
  ]);
  if ((results[0].meta.changes ?? 0) !== 1) return Response.json({ error: "邀请码已被使用" }, { status: 409 });
  return response;
}

export async function createInvitation(env: Env, creatorId: string, email: string | null, role: "user" | "admin", expiresAt: number, token: string, id: string): Promise<void> {
  const hash = await sha256Hex(token);
  await env.DB.prepare(`INSERT INTO invitation (id, token_hash, email, role, expires_at, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, hash, email, role, expiresAt, creatorId, Date.now()).run();
}
