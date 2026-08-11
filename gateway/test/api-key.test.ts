import { describe, expect, it } from "vitest";
import { authenticateApiKey, createOrRotateApiKey, revealApiKey } from "../src/api-key";
import type { Env } from "../src/types";

class ApiKeyDb {
  rows = new Map<string, { hash: string; ciphertext: string }>();
  prepare(sql: string) {
    return { bind: (...args: unknown[]) => ({
      run: async () => {
        if (sql.includes("INSERT INTO api_key")) this.rows.set(args[0] as string, { hash: args[1] as string, ciphertext: args[2] as string });
        return { meta: { changes: 1 } };
      },
      first: async () => {
        if (sql.includes("token_ciphertext")) { const row = this.rows.get(args[0] as string); return row ? { token_ciphertext: row.ciphertext } : null; }
        if (sql.includes("token_hash")) { for (const [userId, row] of this.rows) if (row.hash === args[0]) return { user_id: userId }; }
        return null;
      },
    }) };
  }
}

function env(db: ApiKeyDb): Env {
  return { DB: db as unknown as D1Database, MASTER_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(4))) } as Env;
}

describe("recoverable API keys", () => {
  it("can be revealed whenever the owner is logged in", async () => {
    const e = env(new ApiKeyDb());
    const token = await createOrRotateApiKey(e, "u1");
    await expect(revealApiKey(e, "u1")).resolves.toBe(token);
    await expect(revealApiKey(e, "u2")).resolves.toBeNull();
  });
  it("rotation immediately invalidates the old key", async () => {
    const e = env(new ApiKeyDb());
    const oldToken = await createOrRotateApiKey(e, "u1");
    const newToken = await createOrRotateApiKey(e, "u1");
    await expect(authenticateApiKey(e, `Bearer ${oldToken}`)).resolves.toBeNull();
    await expect(authenticateApiKey(e, `Bearer ${newToken}`)).resolves.toBe("u1");
  });
});
