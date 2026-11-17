import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { SidebarContext } from "../types.ts";
import { renderSidebar } from "../sidebar.ts";

function strip(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function makeCtx(overrides: Partial<SidebarContext> = {}): SidebarContext {
  return {
    sessionTitle: null,
    sessionId: null,
    todos: [],
    panels: { session: true, mcp: true, todos: true, workspace: true },
    workspace: { kind: "fresh", branch: "main", aheadCount: 0, files: [], moreFiles: 0 },
    cwd: "/tmp/test",
    model: null,
    thinkingLevel: null,
    contextTokens: null,
    contextPercent: null,
    contextWindow: null,
    tokensIn: 0,
    tokensOut: 0,
    cacheRead: 0,
    cacheWrite: 0,
    sessionCost: 0,
    turnCount: 0,
    activeTool: null,
    autoCompactEnabled: null,
    sessionStartMs: Date.now(),
    mcpServers: [],
    modelProvider: null,
    liveTps: null,
    lastTps: null,
    lastTurnMs: null,
    ctxSamples: [],
    ...overrides,
  };
}

test("panel toggles remove headers and scroll targets for every combination", () => {
  const ids = ["session", "mcp", "todos", "workspace"] as const;
  for (let mask = 0; mask < 16; mask++) {
    const panels = { session: Boolean(mask & 1), mcp: Boolean(mask & 2), todos: Boolean(mask & 4), workspace: Boolean(mask & 8) };
    const ctx = makeCtx({ panels, mcpServers: [{ name: "test", connected: true, disabled: false, directCount: 1, totalCount: 1, tokenEstimate: 1 }] });
    const rendered = renderSidebar(ctx, 45, 40);
    assert.deepEqual(rendered.layout.map((slot) => slot.id), ["session", "mcp", "todos", "workspace"].filter((id) => panels[id]));
    for (const id of ids) assert.equal(rendered.layout.some((slot) => slot.id === id), panels[id]);
    assert.ok(rendered.lines.every((line) => visibleWidth(line) <= 45));
    assert.ok(rendered.lines.length <= 40);
    if (mask === 0) assert.deepEqual(rendered, { lines: [], layout: [] });
  }
});

test("sidebar stacks all panels", () => {
  const ctx = makeCtx({});
  const { lines } = renderSidebar(ctx, 40);
  const text = lines.map(strip).join("\n");
  assert.ok(text.includes("Session"), "missing Session panel");
  assert.ok(text.includes("Todos"), "missing Todos panel");
  assert.ok(text.includes("Workspace"), "missing Workspace panel");
});

test("sidebar has blank separator lines between panels", () => {
  const ctx = makeCtx({});
  const { lines } = renderSidebar(ctx, 40);
  assert.ok(lines.some(l => strip(l).trim() === ""), "no blank separator line found");
});

test("sidebar all lines at most configured width", () => {
  const ctx = makeCtx({
    sessionTitle: "a".repeat(200),
    todos: [{ id: "1", content: "b".repeat(200), status: "in_progress" }],
  });
  const { lines } = renderSidebar(ctx, 30);
  for (const line of lines) {
    const w = visibleWidth(strip(line));
    assert.ok(w <= 30, `line too wide (${w}): "${strip(line)}"`);
  }
});

test("sidebar width=1 does not throw", () => {
  const ctx = makeCtx({});
  assert.doesNotThrow(() => renderSidebar(ctx, 1));
});

test("sidebar empty states for all panels render without error", () => {
  const ctx = makeCtx({
    sessionTitle: null,
    sessionId: null,
    todos: [],
    workspace: { kind: "not-repo" },
  });
  const { lines } = renderSidebar(ctx, 36);
  assert.ok(lines.length > 0);
  const text = lines.map(strip).join("\n");
  assert.ok(text.includes("waiting for first message"));
  assert.ok(text.includes("no todos"));
  assert.ok(text.includes("not a git repo"));
});
