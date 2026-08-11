import { openJson, randomToken, sealJson, sha256Hex } from "./crypto";
import type { Env } from "./types";

const aad = (userId: string) => `api-key/${userId}`;

export async function createOrRotateApiKey(env: Env, userId: string): Promise<string> {
  const token = randomToken("wxn_");
  const [hash, ciphertext] = await Promise.all([
    sha256Hex(token),
    sealJson({ token }, env.MASTER_KEY, aad(userId)),
  ]);
  const now = Date.now();
  await env.DB.prepare(`INSERT INTO api_key (user_id, token_hash, token_ciphertext, created_at, rotated_at)
    VALUES (?, ?, ?, ?, NULL)
    ON CONFLICT(user_id) DO UPDATE SET token_hash = excluded.token_hash, token_ciphertext = excluded.token_ciphertext, rotated_at = excluded.created_at`)
    .bind(userId, hash, ciphertext, now).run();
  return token;
}

export async function revealApiKey(env: Env, userId: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT token_ciphertext FROM api_key WHERE user_id = ?").bind(userId).first<{ token_ciphertext: string }>();
  if (!row) return null;
  return (await openJson<{ token: string }>(row.token_ciphertext, env.MASTER_KEY, aad(userId))).token;
}

export async function authenticateApiKey(env: Env, authorization: string | undefined): Promise<string | null> {
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token.startsWith("wxn_") || token.length > 100) return null;
  const hash = await sha256Hex(token);
  const row = await env.DB.prepare("SELECT user_id FROM api_key WHERE token_hash = ?").bind(hash).first<{ user_id: string }>();
  return row?.user_id ?? null;
}
