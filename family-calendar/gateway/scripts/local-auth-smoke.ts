import { randomToken, sha256Hex } from "../src/crypto";

const root = new URL("../", import.meta.url);
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
function d1(sql: string): void {
  const result = Bun.spawnSync(["bunx", "wrangler", "d1", "execute", "wx-clawbot-notify-webhook", "--local", "--command", sql], { cwd: root.pathname, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}

const suffix = crypto.randomUUID().slice(0, 8);
const email = `smoke-${suffix}@example.com`;
const password = "Mango!River-2026";
const token = randomToken("wxi_");
const inviteId = crypto.randomUUID();
const hash = await sha256Hex(token);
d1(`INSERT INTO invitation (id, token_hash, email, role, expires_at, created_at) VALUES (${quote(inviteId)}, ${quote(hash)}, ${quote(email)}, 'user', ${Date.now() + 60_000}, ${Date.now()})`);

let userId = "";
try {
  const register = await fetch("http://127.0.0.1:8787/api/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, phone: "13812345678", invitationCode: token }) });
  const registered = await register.json() as { user?: { id?: string }; error?: string; message?: string };
  if (!register.ok || !registered.user?.id) throw new Error(`registration failed: ${register.status} ${registered.error ?? registered.message ?? ""}`);
  userId = registered.user.id;
  const setCookie = register.headers.get("set-cookie");
  if (!setCookie) throw new Error("registration did not return a session cookie");
  const cookie = setCookie.split(";", 1)[0];
  const sessionHeaders = { Cookie: cookie, "Content-Type": "application/json" };

  const dashboard = await fetch("http://127.0.0.1:8787/dashboard", { headers: { Cookie: cookie }, redirect: "manual" });
  if (dashboard.status !== 200) throw new Error(`dashboard failed: ${dashboard.status}`);
  const docs = await fetch("http://127.0.0.1:8787/docs");
  if (!docs.ok || !docs.headers.get("content-type")?.startsWith("text/markdown") || !(await docs.text()).includes("/api/v1/notify/image")) throw new Error("public Markdown docs failed");
  const firstKeyResponse = await fetch("http://127.0.0.1:8787/api/api-key", { method: "POST", headers: sessionHeaders });
  const firstKey = (await firstKeyResponse.json() as { api_key?: string }).api_key;
  if (!firstKeyResponse.ok || !firstKey) throw new Error("API key generation failed");
  const reveal = await fetch("http://127.0.0.1:8787/api/api-key", { headers: { Cookie: cookie } }).then((response) => response.json() as Promise<{ api_key: string }>);
  if (reveal.api_key !== firstKey) throw new Error("API key was not recoverable");
  const rotate = await fetch("http://127.0.0.1:8787/api/api-key", { method: "POST", headers: sessionHeaders }).then((response) => response.json() as Promise<{ api_key: string }>);
  if (!rotate.api_key || rotate.api_key === firstKey) throw new Error("API key rotation failed");
  const payload = JSON.stringify({ text: "smoke", urgent: true });
  const oldResponse = await fetch("http://127.0.0.1:8787/api/v1/notify", { method: "POST", headers: { Authorization: `Bearer ${firstKey}`, "Content-Type": "application/json" }, body: payload });
  const newResponse = await fetch("http://127.0.0.1:8787/api/v1/notify", { method: "POST", headers: { Authorization: `Bearer ${rotate.api_key}`, "Content-Type": "application/json" }, body: payload });
  if (oldResponse.status !== 401 || newResponse.status === 401) throw new Error("rotated API key authentication invariant failed");
  const svgForm = new FormData();
  svgForm.set("image", new Blob(["<svg/>"]), "test.svg");
  svgForm.set("urgent", "true");
  const svgResponse = await fetch("http://127.0.0.1:8787/api/v1/notify/image", { method: "POST", headers: { Authorization: `Bearer ${rotate.api_key}` }, body: svgForm });
  if (svgResponse.status !== 415) throw new Error(`SVG boundary failed: ${svgResponse.status}`);
  const jpegForm = new FormData();
  jpegForm.set("image", new Blob([Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" }), "test.jpg");
  jpegForm.set("urgent", "true");
  const jpegResponse = await fetch("http://127.0.0.1:8787/api/v1/notify/image", { method: "POST", headers: { Authorization: `Bearer ${rotate.api_key}` }, body: jpegForm });
  if (jpegResponse.status === 401 || jpegResponse.status === 415) throw new Error(`JPEG boundary failed: ${jpegResponse.status}`);
  const settings = await fetch("http://127.0.0.1:8787/api/settings", { method: "PUT", headers: sessionHeaders, body: JSON.stringify({ quietStart: "23:30", quietEnd: "06:45", phone: "13812345678" }) });
  if (!settings.ok) throw new Error(`settings update failed: ${settings.status}`);
  console.log("Local smoke passed: auth, API key rotation, public docs, image format boundary, settings.");
} finally {
  d1(`DELETE FROM invitation WHERE id = ${quote(inviteId)};${userId ? ` DELETE FROM user WHERE id = ${quote(userId)};` : ""}`);
}
