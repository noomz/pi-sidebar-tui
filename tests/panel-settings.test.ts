import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_PANELS, loadProjectPanels, saveProjectPanels, parsePanelCommand, parsePanels, resolveProjectRoot } from "../panel-settings.ts";
import { loadSidebarSettings, saveSidebarSettings, DEFAULT_SIDEBAR_SETTINGS } from "../config.ts";

function directory(t: test.TestContext): string {
  const path = mkdtempSync(join(tmpdir(), "sidebar-project-"));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

test("panel configuration validates booleans individually and defaults old settings", (t) => {
  const path = join(directory(t), "global.json");
  writeFileSync(path, JSON.stringify({ panels: { workspace: false, mcp: "false", session: null, unknown: true } }));
  assert.deepEqual(loadSidebarSettings(path).panels, { ...DEFAULT_PANELS, workspace: false });
  writeFileSync(path, JSON.stringify({ width: 50 }));
  assert.deepEqual(loadSidebarSettings(path).panels, DEFAULT_PANELS);
  assert.deepEqual(parsePanels([]), {});
});

test("project overrides are sparse, isolated and removable", (t) => {
  const a = directory(t);
  const b = directory(t);
  const globalPath = join(directory(t), "global.json");
  saveSidebarSettings({ ...DEFAULT_SIDEBAR_SETTINGS, panels: { ...DEFAULT_PANELS, todos: false } }, globalPath);
  saveProjectPanels(a, { workspace: false });
  assert.deepEqual(loadProjectPanels(a), { workspace: false });
  assert.deepEqual({ ...loadSidebarSettings(globalPath).panels, ...loadProjectPanels(a) }, { ...DEFAULT_PANELS, todos: false, workspace: false });
  assert.deepEqual(loadProjectPanels(b), {});
  saveProjectPanels(a, {});
  assert.deepEqual({ ...loadSidebarSettings(globalPath).panels, ...loadProjectPanels(a) }, { ...DEFAULT_PANELS, todos: false });
  writeFileSync(join(a, ".pi", "sidebar-tui.json"), "invalid");
  assert.deepEqual(loadProjectPanels(a), {});
});

test("project root is shared by repository subfolders, without searching children", async (t) => {
  const parent = directory(t);
  const repo = join(parent, "repo");
  const sub = join(repo, "a", "b");
  mkdirSync(sub, { recursive: true });
  execFileSync("git", ["init", "-q", repo]);
  const root = await resolveProjectRoot(repo, parent);
  assert.equal(await resolveProjectRoot(sub, parent), root);
  assert.equal(await resolveProjectRoot(parent, parent), parent);
  const elsewhere = directory(t);
  assert.equal(await resolveProjectRoot(elsewhere, parent), parent);
});

test("panel commands require valid names, actions and scope", () => {
  assert.deepEqual(parsePanelCommand("panel workspace off".split(" ")), { id: "workspace", action: "off", scope: "global" });
  assert.deepEqual(parsePanelCommand("panel session inherit --project".split(" ")), { id: "session", action: "inherit", scope: "project" });
  for (const command of ["panel", "panel bad on", "panel session toggle", "panel session inherit", "panel session inherit --global", "panel session off --typo", "panel session off --global --project"]) {
    assert.equal(parsePanelCommand(command.split(" ")), null, command);
  }
});
