import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WorkspaceReader } from "../workspace.ts";
import { directory, git, makeRepo, instrumentGit, until } from "./helpers/git-fixture.ts";

function refresh(reader: WorkspaceReader, cwd: string) {
  return new Promise<ReturnType<WorkspaceReader["read"]>>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("refresh did not complete")), 5000);
    reader.onUpdate(() => {
      clearTimeout(timeout);
      resolve(reader.read(cwd));
    });
    reader.read(cwd);
  });
}

test("reads return immediately and reuse the resolved snapshot", async (t) => {
  const cwd = makeRepo(t);
  const reader = new WorkspaceReader();
  const first = reader.read(cwd);
  assert.deepEqual(first, { kind: "loading" });
  const data = await refresh(reader, cwd);
  assert.equal(data.kind, "fresh");
  if (data.kind !== "fresh") return;
  assert.equal(data.branch, "trunk");
  assert.equal(data.aheadCount, null);
  assert.deepEqual(data.files, []);
  assert.equal(reader.read(cwd), data);
  reader.stop();
});

test("tracked changes work from a subdirectory; untracked trees and submodules are excluded", async (t) => {
  const cwd = makeRepo(t);
  const submodule = makeRepo(t);
  git(cwd, "-c", "protocol.file.allow=always", "submodule", "add", "-q", submodule, "submodule");
  git(cwd, "commit", "-qam", "submodule");
  writeFileSync(join(cwd, "submodule", "tracked.txt"), "changed\n");
  git(join(cwd, "submodule"), "commit", "-qam", "nested change");
  const nested = join(cwd, "untracked", "deep", "tree");
  mkdirSync(nested, { recursive: true });
  for (let i = 0; i < 100; i++) writeFileSync(join(nested, `file-${i}`), "untracked");
  git(nested, "init", "-q");
  writeFileSync(join(cwd, "tracked.txt"), "one\ntwo\nthree\n");
  const trace = instrumentGit(t);
  const reader = new WorkspaceReader();
  const data = await refresh(reader, join(cwd, "untracked"));
  assert.equal(data.kind, "fresh");
  if (data.kind !== "fresh") return;
  assert.deepEqual(data.files, [{ path: "tracked.txt", added: 2, removed: 0 }]);
  assert.equal(trace.calls().some(({ args }) => args.includes("status")), false);
  assert.ok(trace.calls().find(({ args }) => args.includes("diff"))?.args.includes("--ignore-submodules=all"));
  reader.stop();
});

test("distinguishes non-repositories and handles unborn and detached HEAD", async (t) => {
  const reader = new WorkspaceReader();
  assert.deepEqual(reader.read(undefined), { kind: "unavailable" });
  const cwd = directory(t);
  assert.deepEqual(await refresh(reader, cwd), { kind: "not-repo" });
  reader.stop();
  git(cwd, "init", "-q", "-b", "new-branch");
  writeFileSync(join(cwd, "new.txt"), "new\n");
  git(cwd, "add", ".");
  const unborn = await refresh(reader, cwd);
  assert.equal(unborn.kind, "fresh");
  if (unborn.kind !== "fresh") return;
  assert.equal(unborn.branch, "new-branch");
  assert.equal(unborn.files[0].path, "new.txt");
  reader.stop();
  git(cwd, "commit", "-qm", "first");
  git(cwd, "checkout", "--detach", "-q");
  const detached = await refresh(reader, cwd);
  assert.equal(detached.kind, "fresh");
  if (detached.kind === "fresh") assert.match(detached.branch, /^detached /);
  reader.stop();
});

test("numstat handles binary and unusual paths and reports omitted files", async (t) => {
  const cwd = makeRepo(t);
  const unusual = "tab\tand\nnewline.txt";
  writeFileSync(join(cwd, unusual), "a\n");
  writeFileSync(join(cwd, "binary"), Buffer.from([0, 1, 2]));
  for (let i = 0; i < 20; i++) writeFileSync(join(cwd, `file${i}`), "a\n");
  git(cwd, "add", ".");
  const reader = new WorkspaceReader();
  const result = await refresh(reader, cwd);
  assert.equal(result.kind, "fresh");
  if (result.kind !== "fresh") return;
  assert.equal(result.files.length, 15);
  assert.equal(result.moreFiles, 7);
  reader.stop();
  git(cwd, "commit", "-qm", "files");
  writeFileSync(join(cwd, unusual), "a\nb\n");
  writeFileSync(join(cwd, "binary"), Buffer.from([0, 4, 5]));
  const changed = await refresh(reader, cwd);
  if (changed.kind !== "fresh") assert.fail("expected snapshot");
  assert.ok(changed.files.some((file) => file.path === unusual));
  assert.ok(changed.files.some((file) => file.path === "binary"));
  reader.stop();
});

test("invalidation cannot bypass the refresh interval or launch overlapping work", async (t) => {
  const cwd = makeRepo(t);
  const trace = instrumentGit(t);
  const reader = new WorkspaceReader();
  await refresh(reader, cwd);
  const count = trace.calls().length;
  for (let i = 0; i < 100; i++) { reader.invalidate(); reader.read(cwd); }
  assert.equal(reader.read(cwd).kind, "stale");
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(trace.calls().length, count);
  reader.stop();
});

test("invalidated data refreshes after the cooldown without another render", async (t) => {
  const cwd = makeRepo(t);
  const reader = new WorkspaceReader({ refreshMs: 100 });
  await refresh(reader, cwd);
  writeFileSync(join(cwd, "tracked.txt"), "one\ntwo\n");
  let updated = false;
  reader.onUpdate(() => { updated = true; });
  reader.invalidate();
  await until(() => updated);
  const data = reader.read(cwd);
  if (data.kind !== "fresh") assert.fail("expected fresh snapshot");
  assert.equal(data.files[0].added, 1);
  reader.stop();
});

test("stop cancels an invalidation queued behind the cooldown", async (t) => {
  const cwd = makeRepo(t);
  const trace = instrumentGit(t);
  const reader = new WorkspaceReader({ refreshMs: 100 });
  await refresh(reader, cwd);
  const count = trace.calls().length;
  let updates = 0;
  reader.onUpdate(() => updates++);
  reader.invalidate();
  reader.stop();
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(trace.calls().length, count);
  assert.equal(updates, 0);
});

test("deadline kills Git and reports unavailable, not clean", async (t) => {
  const cwd = makeRepo(t);
  const trace = instrumentGit(t);
  trace.mode("hang");
  const reader = new WorkspaceReader({ deadlineMs: 800 });
  const result = await refresh(reader, cwd);
  assert.deepEqual(result, { kind: "unavailable" });
  await until(() => trace.calls().every(({ pid }) => {
    try { process.kill(pid, 0); return false; } catch { return true; }
  }));
  assert.equal(trace.calls().length, 1);
  reader.stop();
});

test("output overflow preserves the previous snapshot as stale", async (t) => {
  const cwd = makeRepo(t);
  writeFileSync(join(cwd, "tracked.txt"), "one\ntwo\n");
  const trace = instrumentGit(t);
  const reader = new WorkspaceReader({ refreshMs: 300, maxBuffer: 1024 });
  const good = await refresh(reader, cwd);
  assert.equal(good.kind, "fresh");
  trace.mode("overflow");
  await new Promise((resolve) => setTimeout(resolve, 310));
  const stale = await refresh(reader, cwd);
  assert.equal(stale.kind, "stale");
  if (stale.kind === "stale" && good.kind === "fresh") assert.deepEqual(stale.files, good.files);
  reader.stop();
});

test("stop and cwd changes cancel old work and prevent late publication", async (t) => {
  const a = makeRepo(t);
  const b = makeRepo(t);
  git(b, "branch", "-m", "other");
  const trace = instrumentGit(t);
  trace.mode("hang");
  const reader = new WorkspaceReader();
  let updates = 0;
  reader.onUpdate(() => updates++);
  reader.read(a);
  await until(() => trace.calls().length === 1);
  trace.mode("normal");
  const result = await refresh(reader, b);
  assert.equal(result.kind, "fresh");
  if (result.kind === "fresh") assert.equal(result.branch, "other");
  assert.equal(updates, 0);
  reader.stop();
  trace.mode("hang");
  const count = trace.calls().length;
  reader.onUpdate(() => updates++);
  reader.read(a);
  await until(() => trace.calls().length > count);
  reader.stop();
  await until(() => trace.calls().every(({ pid }) => {
    try { process.kill(pid, 0); return false; } catch { return true; }
  }));
  assert.equal(updates, 0);
});
