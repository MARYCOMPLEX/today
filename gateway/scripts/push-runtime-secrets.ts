const root = new URL("../", import.meta.url);
const values = Object.fromEntries((await Bun.file(new URL(".dev.vars", root)).text()).split(/\r?\n/).filter(Boolean).map((line) => {
  const index = line.indexOf("="); return [line.slice(0, index), line.slice(index + 1)];
}));
for (const name of ["BETTER_AUTH_SECRET", "MASTER_KEY", "GITHUB_TOKEN"] as const) {
  const value = values[name];
  if (!value) throw new Error(`${name} is missing from .dev.vars`);
  const child = Bun.spawnSync(["bunx", "wrangler", "secret", "put", name], {
    cwd: root.pathname, stdin: new TextEncoder().encode(`${value}\n`), stdout: "inherit", stderr: "inherit",
  });
  if (child.exitCode !== 0) throw new Error(`Failed to push ${name}`);
}
console.log("Runtime secrets pushed; ADMIN_EMAIL/ADMIN_PASSWORD not uploaded; GITHUB_TOKEN optional.");
