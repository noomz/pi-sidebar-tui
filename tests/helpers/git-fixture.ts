import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";

export const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "sidebar-test", GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "sidebar-test", GIT_COMMITTER_EMAIL: "test@example.com",
  GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null",
};

export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8" }).trim();
}

export function directory(t: TestContext): string {
  const path = mkdtempSync(join(tmpdir(), "sidebar-git-"));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

export function makeRepo(t: TestContext): string {
  const path = directory(t);
  git(path, "init", "-q", "-b", "trunk");
  writeFileSync(join(path, "tracked.txt"), "one\n");
  git(path, "add", ".");
  git(path, "commit", "-q", "-m", "init");
  return path;
}

export function instrumentGit(t: TestContext) {
  const dir = directory(t);
  const log = join(dir, "calls");
  const mode = join(dir, "mode");
  const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  writeFileSync(log, "");
  writeFileSync(mode, "normal");
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "git"), `#!/usr/bin/env node
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const args = process.argv.slice(2);
const command = args[0] === "-c" ? args[2] : args[0];
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, pid: process.pid }) + "\\n");
const mode = fs.readFileSync(${JSON.stringify(mode)}, "utf8");
if (mode === "hang" || (mode === "hang-diff" && command === "diff")) {
  setInterval(() => {}, 1000);
} else if (mode === "overflow" && command === "diff") {
  process.stdout.write("x".repeat(1024 * 1024));
} else {
  const r = spawnSync(${JSON.stringify(realGit)}, args, { env: process.env });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  process.exit(r.status ?? 1);
}
`, { mode: 0o755 });
  const oldPath = process.env.PATH;
  process.env.PATH = `${bin}:${oldPath}`;
  t.after(() => { process.env.PATH = oldPath; });
  return {
    mode: (value: string) => writeFileSync(mode, value),
    calls: (): { args: string[]; pid: number }[] => readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)),
  };
}

export async function until(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Condition did not become true");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
