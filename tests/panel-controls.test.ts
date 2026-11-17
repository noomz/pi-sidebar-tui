import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { saveProjectPanels, loadProjectPanels, DEFAULT_PANELS } from "../panel-settings.ts";
import { directory, makeRepo, instrumentGit, until } from "./helpers/git-fixture.ts";

// Drive the registered commands and real compositor with an in-memory terminal.
test("project toggles control rendering, collection, persistence and restart", async (t) => {
  const root = makeRepo(t);
  const sub = join(root, "sub");
  mkdirSync(sub);
  const globalPath = join(directory(t), "global.json");
  const previous = process.env.PI_SIDEBAR_CONFIG;
  process.env.PI_SIDEBAR_CONFIG = globalPath;
  t.after(() => {
    if (previous === undefined) delete process.env.PI_SIDEBAR_CONFIG;
    else process.env.PI_SIDEBAR_CONFIG = previous;
  });
  saveProjectPanels(root, { workspace: false, mcp: false });
  const trace = instrumentGit(t);
  const { default: piSidebar } = await import("../index.ts");
  const commands = new Map<string, any>();
  const events = new Map<string, ((event: any, ctx: any) => Promise<void>)[]>();
  const messages: string[] = [];
  let mcpReads = 0;
  let output = "";
  const terminal = { columns: 120, rows: 50, write(text: string) { output += text; } };
  const tui = { terminal, doRender() { terminal.write("\n"); }, requestRender() {} };
  const ctx = {
    cwd: sub, hasUI: true,
    sessionManager: { getSessionName: () => null, getBranch: () => [], getSessionId: () => "test" },
    ui: {
      notify(message: string) { messages.push(message); },
      setWidget(_name: string, factory: any) { factory(tui, null); },
    },
  };
  piSidebar({
    on(name: string, handler: any) { events.set(name, [...(events.get(name) ?? []), handler]); },
    registerCommand(name: string, command: any) { commands.set(name, command); },
    registerShortcut() {},
    getAllTools() { mcpReads++; return []; },
  } as any);
  const emit = async (name: string) => {
    for (const handler of events.get(name) ?? []) await handler({}, ctx);
  };
  const command = (args: string) => commands.get("sidebar-tui").handler(args, ctx);
  const paint = () => { output = ""; tui.doRender(); return output; };
  t.after(() => emit("session_shutdown"));
  await emit("session_start");
  assert.ok(paint().includes("Session"));
  assert.ok(!paint().includes("Workspace"));
  assert.equal(mcpReads, 0);
  assert.equal(trace.calls().length, 1, "only the root lookup may run while workspace is disabled");
  assert.deepEqual(trace.calls()[0].args, ["rev-parse", "--show-toplevel"]);

  await command("panel workspace on --global");
  assert.match(messages.at(-1)!, /workspace: off \(project override\)/);
  assert.ok(!paint().includes("Workspace"));
  await command("width 50");
  assert.deepEqual(JSON.parse(readFileSync(globalPath, "utf8")).panels, DEFAULT_PANELS);
  assert.deepEqual(loadProjectPanels(root), { workspace: false, mcp: false });

  await command("panel workspace inherit --project");
  assert.ok(paint().includes("Workspace"));
  await until(() => trace.calls().some(({ args }) => args.includes("diff")));
  await command("panel workspace off --project");
  const count = trace.calls().length;
  for (let i = 0; i < 10; i++) paint();
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(trace.calls().length, count);

  for (const panel of ["session", "todos", "mcp"]) await command(`panel ${panel} off --project`);
  const empty = paint();
  assert.ok(!empty.includes("Session") && !empty.includes("Todos") && !empty.includes("Workspace"));
  assert.ok(empty.includes("sub"), "cwd remains pinned");
  assert.equal(terminal.columns, 69);
  await command("off");
  assert.equal(terminal.columns, 120, "whole-sidebar off restores terminal width");
  await command("on");
  assert.equal(terminal.columns, 69);

  await emit("session_shutdown");
  await emit("session_start");
  assert.ok(!paint().includes("Workspace"));
  await command("panel session inherit --project");
  assert.ok(paint().includes("Session"));
  await command("panel mcp on --project");
  paint();
  assert.ok(mcpReads > 0);
  await command("panel mcp inherit --global");
  assert.match(messages.at(-1)!, /Usage:/);
  await emit("session_shutdown");
});
