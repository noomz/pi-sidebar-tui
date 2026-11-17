import { execFile } from "node:child_process";
import type { WorkspaceFile } from "./types.ts";

export interface WorkspaceData {
  branch: string | null;
  aheadCount: number;
  untrackedCount: number;
  files: WorkspaceFile[];
}

const EMPTY: WorkspaceData = { branch: null, aheadCount: 0, untrackedCount: 0, files: [] };
const COMMAND_TIMEOUT_MS = 2000;

/** Minimum age before the next background refresh. The refresh itself never blocks a render. */
const CACHE_TTL_MS = 5000;

// Cache is keyed by cwd: a serve-stale read is only valid inside the directory
// it was measured in, otherwise a `cd` renders another repo's branch/diff stats.
let cache: { cwd: string; data: WorkspaceData; timestamp: number } | null = null;
let pending: { cwd: string; promise: Promise<WorkspaceData> } | null = null;
let updateHandler: (() => void) | null = null;

/**
 * Called after a background refresh replaces the cached snapshot, so the host
 * can repaint. Without it the first paint of a directory stays branch-less
 * until the next unrelated render.
 */
export function setWorkspaceUpdateHandler(handler: (() => void) | null): void {
  updateHandler = handler;
}

/**
 * Git probes are async on purpose: `getWorkspaceData` runs on the TUI render
 * path, and `execSync` there blocks input for the duration of the command —
 * ~1s per refresh in a submodule-heavy repo, which reads as typing lag.
 */
function run(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      { cwd, encoding: "utf-8", timeout: COMMAND_TIMEOUT_MS, windowsHide: true },
      (error: Error | null, stdout: string) => {
        if (error) {
          resolve("");
          return;
        }
        resolve((stdout ?? "").trim());
      },
    );
  });
}

async function fetchBranch(cwd: string): Promise<string | null> {
  return (await run(["branch", "--show-current"], cwd)) || null;
}

async function fetchAhead(cwd: string): Promise<number> {
  const out = await run(["rev-list", "@{u}..HEAD", "--count"], cwd);
  const n = parseInt(out, 10);
  return isNaN(n) ? 0 : n;
}

async function fetchUntracked(cwd: string): Promise<number> {
  const out = await run(["status", "--porcelain"], cwd);
  if (!out) return 0;
  return out.split("\n").filter((l) => l.startsWith("??")).length;
}

async function fetchNumstat(cwd: string): Promise<WorkspaceFile[]> {
  const out = await run(["diff", "--numstat", "HEAD"], cwd);
  if (!out) return [];

  return out
    .split("\n")
    .map((line) => {
      const parts = line.split("\t");
      if (parts.length < 3) return null;
      const added = parseInt(parts[0], 10);
      const removed = parseInt(parts[1], 10);
      const path = parts[2].trim();
      if (isNaN(added) || isNaN(removed) || !path) return null;
      return { path, added, removed };
    })
    .filter((f): f is WorkspaceFile => f !== null)
    .sort((a, b) => b.added + b.removed - (a.added + a.removed))
    .slice(0, 15);
}

async function fetchWorkspaceData(cwd: string): Promise<WorkspaceData> {
  const branch = await fetchBranch(cwd);
  if (!branch) return EMPTY;

  // The three probes are independent; run them together so one slow command
  // does not serialize behind the others.
  const [aheadCount, untrackedCount, files] = await Promise.all([
    fetchAhead(cwd),
    fetchUntracked(cwd),
    fetchNumstat(cwd),
  ]);
  return { branch, aheadCount, untrackedCount, files };
}

function startRefresh(cwd: string): void {
  const promise = fetchWorkspaceData(cwd)
    .then((data) => {
      // The directory may have changed while the probes ran; publishing now
      // would paint the old repo into the new one.
      if (pending?.cwd === cwd) {
        cache = { cwd, data, timestamp: Date.now() };
        pending = null;
        updateHandler?.();
      }
      return data;
    })
    .catch(() => {
      if (pending?.cwd === cwd) pending = null;
      return cache?.data ?? EMPTY;
    });

  pending = { cwd, promise };
}

/**
 * Never blocks: returns the cached snapshot for `cwd` immediately (or an empty
 * one on first sight of a directory) and refreshes it in the background once it
 * is older than the TTL.
 */
export function getWorkspaceData(cwd: string | undefined): WorkspaceData {
  if (!cwd) return EMPTY;

  const now = Date.now();
  const fresh = cache && cache.cwd === cwd && now - cache.timestamp < CACHE_TTL_MS;
  if (fresh) return cache!.data;

  if (!pending || pending.cwd !== cwd) startRefresh(cwd);

  return cache && cache.cwd === cwd ? cache.data : EMPTY;
}

export function invalidateWorkspaceCache(): void {
  cache = null;
}
