import { randomToken, sha256Hex } from "../src/crypto";
import { mkdir } from "node:fs/promises";

const root = new URL("../", import.meta.url);
await mkdir(new URL(".local/", root), { recursive: true });
const values = Object.fromEntries((await Bun.file(new URL(".dev.vars", root)).text()).split(/\r?\n/).filter(Boolean).map((line) => {
  const index = line.indexOf("="); return [line.slice(0, index), line.slice(index + 1)];
}));
if (!values.ADMIN_EMAIL || !values.PUBLIC_ORIGIN) throw new Error("ADMIN_EMAIL and PUBLIC_ORIGIN are required in .dev.vars");
const output = new URL(".local/bootstrap-admin-invite", root);
if (await Bun.file(output).exists()) {
  console.log("Bootstrap invite already exists in .local/bootstrap-admin-invite; no new invite was created.");
  process.exit(0);
}

const token = randomToken("wxi_");
const id = crypto.randomUUID();
const hash = await sha256Hex(token);
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const sql = `INSERT INTO invitation (id, token_hash, email, role, expires_at, created_by, created_at)
VALUES (${quote(id)}, ${quote(hash)}, ${quote(values.ADMIN_EMAIL.toLowerCase())}, 'admin', ${Date.now() + 30 * 24 * 60 * 60_000}, NULL, ${Date.now()});`;
const child = Bun.spawnSync([
  "bunx", "wrangler", "d1", "execute", "wx-clawbot-notify-webhook", "--remote", "--command", sql,
], { cwd: root.pathname, stdout: "inherit", stderr: "inherit" });
if (child.exitCode !== 0) throw new Error("Failed to seed bootstrap invitation");
await Bun.write(output, `${values.PUBLIC_ORIGIN.replace(/\/$/, "")}/register?invite=${encodeURIComponent(token)}\n`);
console.log("Bootstrap admin invitation saved to gitignored .local/bootstrap-admin-invite (value not printed).");
