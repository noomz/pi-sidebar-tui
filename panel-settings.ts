import { execFile } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { PanelId, PanelSettings } from "./types.ts";

export const DEFAULT_PANELS: PanelSettings = { session: true, mcp: true, todos: true, workspace: true };
export const NO_PANELS: PanelSettings = { session: false, mcp: false, todos: false, workspace: false };
export const PANEL_IDS: PanelId[] = ["session", "mcp", "todos", "workspace"];

export function isPanelId(value: string): value is PanelId {
  return PANEL_IDS.some((id) => id === value);
}

export function parsePanels(value: unknown): Partial<PanelSettings> {
  const panels: Partial<PanelSettings> = {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) return panels;
  for (const id of PANEL_IDS) {
    if (id in value) {
      const enabled = Reflect.get(value, id);
      if (typeof enabled === "boolean") panels[id] = enabled;
    }
  }
  return panels;
}

export function projectConfigPath(root: string): string {
  return join(root, ".pi", "sidebar-tui.json");
}

export function loadProjectPanels(root: string): Partial<PanelSettings> {
  try {
    const value: unknown = JSON.parse(readFileSync(projectConfigPath(root), "utf8"));
    return typeof value === "object" && value !== null && "panels" in value ? parsePanels(value.panels) : {};
  } catch {
    return {};
  }
}

export function saveProjectPanels(root: string, panels: Partial<PanelSettings>): void {
  const path = projectConfigPath(root);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ panels }, null, 2) + "\n", "utf8");
}

export function resolveProjectRoot(cwd: string, sessionCwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", ["rev-parse", "--show-toplevel"], {
      cwd, encoding: "utf8", timeout: 2000, maxBuffer: 64 * 1024,
      env: { ...process.env, LC_ALL: "C", GIT_OPTIONAL_LOCKS: "0" },
    }, (error, stdout, stderr) => {
      if (!error && stdout.trim()) resolve(stdout.trim());
      else if (stderr.includes("not a git repository")) resolve(sessionCwd);
      else reject(error ?? new Error("Cannot resolve project root"));
    });
  });
}

export type PanelCommand = {
  id: PanelId;
  action: "on" | "off" | "inherit";
  scope: "global" | "project";
};

export const PANEL_USAGE = "Usage: /sidebar-tui panel <session|mcp|todos|workspace> <on|off> [--global|--project], or <panel> inherit --project";

export function parsePanelCommand(parts: string[]): PanelCommand | null {
  const [, id, action, flag] = parts;
  if (parts.length < 3 || parts.length > 4 || !isPanelId(id)) return null;
  if (action !== "on" && action !== "off" && action !== "inherit") return null;
  if (flag !== undefined && flag !== "--global" && flag !== "--project") return null;
  const scope = flag === "--project" ? "project" : "global";
  if (action === "inherit" && scope !== "project") return null;
  return { id, action, scope };
}
