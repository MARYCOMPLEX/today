import { randomToken } from "../src/crypto";

const root = new URL("../", import.meta.url);
const varsUrl = new URL(".dev.vars", root);
const source = await Bun.file(varsUrl).text();
const values = Object.fromEntries(source.split(/\r?\n/).filter(Boolean).map((line) => {
  const index = line.indexOf("="); return [line.slice(0, index), line.slice(index + 1)];
}));
if (!values.ADMIN_EMAIL || !values.PUBLIC_ORIGIN) throw new Error("ADMIN_EMAIL and PUBLIC_ORIGIN are required in .dev.vars");
if (values.ADMIN_EMAIL && values.ADMIN_PASSWORD) {
  console.log("Admin credentials already exist in .dev.vars; no account change was made.");
  process.exit(0);
}
const inviteFile = Bun.file(new URL(".local/bootstrap-admin-invite", root));
if (!(await inviteFile.exists())) throw new Error(".local/bootstrap-admin-invite is missing");
const inviteUrl = new URL((await inviteFile.text()).trim());
const invitationCode = inviteUrl.searchParams.get("invite");
if (!invitationCode) throw new Error("bootstrap invitation file is invalid");
const email = values.ADMIN_EMAIL.toLowerCase();
const origin = values.PUBLIC_ORIGIN.replace(/\/$/, "");
const password = `Adm!${randomToken("").slice(0, 38)}`;
const response = await fetch(`${origin}/api/register`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password, invitationCode }),
});
const body = await response.json().catch(() => ({})) as { error?: string; message?: string };
if (!response.ok) throw new Error(`Admin registration failed: ${response.status} ${body.error ?? body.message ?? ""}`);
const login = await fetch(`${origin}/api/auth/sign-in/email`, {
  method: "POST", headers: { "Content-Type": "application/json", Origin: origin },
  body: JSON.stringify({ email, password }),
});
if (!login.ok) throw new Error(`Admin login verification failed: ${login.status}`);
await Bun.write(varsUrl, `${source.trimEnd()}\nADMIN_EMAIL=${email}\nADMIN_PASSWORD=${password}\n`);
console.log("Production admin registered and credentials saved to gitignored .dev.vars (values not printed).");
