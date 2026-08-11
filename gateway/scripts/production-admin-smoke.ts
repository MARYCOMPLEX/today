const root = new URL("../", import.meta.url);
const values = Object.fromEntries((await Bun.file(new URL(".dev.vars", root)).text()).split(/\r?\n/).filter(Boolean).map((line) => {
  const index = line.indexOf("="); return [line.slice(0, index), line.slice(index + 1)];
}));
if (!values.ADMIN_EMAIL || !values.ADMIN_PASSWORD || !values.PUBLIC_ORIGIN) throw new Error("Admin credentials or PUBLIC_ORIGIN are missing from .dev.vars");
const origin = values.PUBLIC_ORIGIN.replace(/\/$/, "");
const login = await fetch(`${origin}/api/auth/sign-in/email`, {
  method: "POST", headers: { "Content-Type": "application/json", Origin: origin },
  body: JSON.stringify({ email: values.ADMIN_EMAIL, password: values.ADMIN_PASSWORD }),
});
if (!login.ok) throw new Error(`Production admin login failed: ${login.status}`);
const setCookie = login.headers.get("set-cookie");
if (!setCookie) throw new Error("Production login did not return a session cookie");
const cookie = setCookie.split(";", 1)[0];
const dashboard = await fetch(`${origin}/dashboard`, { headers: { Cookie: cookie } });
const html = await dashboard.text();
for (const marker of ["API Key", "复制 Markdown", "管理员：创建邀请码"]) {
  if (!dashboard.ok || !html.includes(marker)) throw new Error(`Production dashboard is missing: ${marker}`);
}
console.log("Production admin smoke passed: login, session and admin dashboard rendering.");
