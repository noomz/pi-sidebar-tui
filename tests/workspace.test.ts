import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getWorkspaceData,
  invalidateWorkspaceCache,
  setWorkspaceUpdateHandler,
  type WorkspaceData,
} from "../workspace.ts";

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "pi-sidebar-tui",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "pi-sidebar-tui",
  GIT_COMMITTER_EMAIL: "test@example.com",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, env: GIT_ENV, encoding: "utf-8" }).trim();
}

/** A repo with one commit and one untracked file. */
function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "sidebar-ws-"));
  git(dir, "init", "-q", "-b", "trunk");
  writeFileSync(join(dir, "tracked.txt"), "one\n");
  git(dir, "add", "tracked.txt");
  git(dir, "commit", "-q", "-m", "init");
  writeFileSync(join(dir, "untracked.txt"), "new\n");
  return dir;
}

/** Resolve once a background refresh has published a branch for `cwd`. */
function waitForBranch(cwd: string, timeoutMs = 5000): Promise<WorkspaceData> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      setWorkspaceUpdateHandler(null);
      reject(new Error("workspace refresh did not publish in time"));
    }, timeoutMs);
    const poll = () => {
      const data = getWorkspaceData(cwd);
      if (data.branch) {
        clearTimeout(timer);
        setWorkspaceUpdateHandler(null);
        resolve(data);
        return;
      }
      setTimeout(poll, 25);
    };
    poll();
  });
}

test("getWorkspaceData returns without waiting for git (no blocking render)", async () => {
  invalidateWorkspaceCache();
  const dir = makeRepo();

  const started = Date.now();
  const first = getWorkspaceData(dir);
  const elapsed = Date.now() - started;

  // First sight of a directory has no snapshot yet: an empty one is served
  // while the probes run in the background.
  assert.equal(first.branch, null);
  assert.deepEqual(first.files, []);
  assert.ok(elapsed < 250, `first read took ${elapsed}ms; git must not run inline`);

  const data = await waitForBranch(dir);
  assert.equal(data.branch, "trunk");
  assert.equal(data.untrackedCount, 1);
  assert.deepEqual(data.files, []);
});

test("a resolved snapshot is served from cache on the next read", async () => {
  invalidateWorkspaceCache();
  const dir = makeRepo();
  const data = await waitForBranch(dir);
  assert.equal(data.branch, "trunk");

  const again = getWorkspaceData(dir);
  assert.equal(again.branch, "trunk");
  assert.equal(again, data, "the cached object should be reused, not refetched");
});

test("a snapshot is not served for a different cwd", async () => {
  invalidateWorkspaceCache();
  const repoA = makeRepo();
  const repoB = makeRepo();
  await waitForBranch(repoA);

  const other = getWorkspaceData(repoB);
  assert.equal(other.branch, null, "another directory must not inherit repo A's branch");
  const b = await waitForBranch(repoB);
  assert.equal(b.branch, "trunk");
});

test("a directory that is not a repo resolves to empty and stays empty", async () => {
  invalidateWorkspaceCache();
  const dir = mkdtempSync(join(tmpdir(), "sidebar-nogit-"));

  assert.equal(getWorkspaceData(dir).branch, null);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(getWorkspaceData(dir).branch, null);
});

test("undefined cwd short-circuits", () => {
  invalidateWorkspaceCache();
  assert.deepEqual(getWorkspaceData(undefined), {
    branch: null,
    aheadCount: 0,
    untrackedCount: 0,
    files: [],
  });
});

test("dirty tracked files report diff stats", async () => {
  invalidateWorkspaceCache();
  const dir = makeRepo();
  writeFileSync(join(dir, "tracked.txt"), "one\ntwo\nthree\n");

  const data = await waitForBranch(dir);
  assert.equal(data.branch, "trunk");
  assert.deepEqual(data.files, [{ path: "tracked.txt", added: 2, removed: 0 }]);
});
