import { execFile } from "node:child_process";
import type { WorkspaceData, WorkspaceFile } from "./types.ts";
export type { WorkspaceData } from "./types.ts";

const LOADING: WorkspaceData = { kind: "loading" };
const NOT_REPO: WorkspaceData = { kind: "not-repo" };
const UNAVAILABLE: WorkspaceData = { kind: "unavailable" };
const MAX_FILES = 15;

interface ReaderOptions {
  refreshMs?: number;
  deadlineMs?: number;
  maxBuffer?: number;
}

export class WorkspaceReader {
  private cwd: string | undefined;
  private data: WorkspaceData = LOADING;
  private nextRefresh = 0;
  private pending: AbortController | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private updateHandler: (() => void) | null = null;
  private readonly refreshMs: number;
  private readonly deadlineMs: number;
  private readonly maxBuffer: number;

  constructor(options: ReaderOptions = {}) {
    this.refreshMs = options.refreshMs ?? 5000;
    this.deadlineMs = options.deadlineMs ?? 2000;
    this.maxBuffer = options.maxBuffer ?? 256 * 1024;
  }

  onUpdate(handler: (() => void) | null): void {
    this.updateHandler = handler;
  }

  stop(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    this.pending?.abort();
    this.pending = null;
    this.cwd = undefined;
    this.data = LOADING;
    this.nextRefresh = 0;
  }

  invalidate(): void {
    if (this.data.kind === "fresh") this.data = { ...this.data, kind: "stale" };
    if (this.cwd && !this.pending) this.scheduleRefresh(this.cwd);
  }

  private scheduleRefresh(cwd: string): void {
    if (this.refreshTimer) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      this.read(cwd);
    }, Math.max(0, this.nextRefresh - Date.now()));
    this.refreshTimer.unref?.();
  }

  read(cwd: string | undefined): WorkspaceData {
    if (cwd !== this.cwd) {
      this.stop();
      this.cwd = cwd;
    }
    if (!cwd) return UNAVAILABLE;
    if (!this.pending) {
      if (Date.now() >= this.nextRefresh) this.start(cwd);
      else if (this.data.kind === "stale") this.scheduleRefresh(cwd);
    }
    return this.data;
  }

  private run(args: string[], cwd: string, signal: AbortSignal): Promise<{ ok: boolean; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      execFile("git", ["-c", "core.fsmonitor=false", ...args], {
        cwd, signal, killSignal: "SIGKILL", encoding: "utf8", maxBuffer: this.maxBuffer,
        windowsHide: true, env: { ...process.env, LC_ALL: "C", GIT_OPTIONAL_LOCKS: "0" },
      }, (error, stdout, stderr) => resolve({ ok: !error, stdout, stderr }));
    });
  }

  private async fetch(cwd: string, signal: AbortSignal): Promise<WorkspaceData> {
    const inside = await this.run(["rev-parse", "--is-inside-work-tree"], cwd, signal);
    if (!inside.ok) {
      return inside.stderr.includes("not a git repository") ? NOT_REPO : UNAVAILABLE;
    }
    if (inside.stdout.trim() !== "true") return NOT_REPO;
    const [name, head] = await Promise.all([
      this.run(["symbolic-ref", "--quiet", "--short", "HEAD"], cwd, signal),
      this.run(["rev-parse", "--verify", "--quiet", "HEAD"], cwd, signal),
    ]);
    const branch = name.ok ? name.stdout.trim() : head.ok ? `detached ${head.stdout.trim().slice(0, 7)}` : null;
    if (!branch || signal.aborted) return UNAVAILABLE;
    const [diff, ahead] = await Promise.all([
      this.run(["diff", "--numstat", "-z", "--no-renames", "--no-ext-diff", "--no-textconv", "--ignore-submodules=all", ...(head.ok ? ["HEAD"] : ["--cached"])], cwd, signal),
      this.run(["rev-list", "--count", "@{u}..HEAD"], cwd, signal),
    ]);
    if (!diff.ok || signal.aborted) return UNAVAILABLE;
    const files: WorkspaceFile[] = [];
    for (const record of diff.stdout.split("\0")) {
      if (!record) continue;
      const match = /^(\d+|-)\t(\d+|-)\t([\s\S]+)$/.exec(record);
      if (!match) return UNAVAILABLE;
      files.push({ path: match[3], added: match[1] === "-" ? 0 : Number(match[1]), removed: match[2] === "-" ? 0 : Number(match[2]) });
    }
    files.sort((a, b) => b.added + b.removed - a.added - a.removed);
    const aheadCount = ahead.ok && /^\d+$/.test(ahead.stdout.trim()) ? Number(ahead.stdout.trim()) : null;
    return { kind: "fresh", branch, aheadCount, files: files.slice(0, MAX_FILES), moreFiles: Math.max(0, files.length - MAX_FILES) };
  }

  private start(cwd: string): void {
    const controller = new AbortController();
    this.pending = controller;
    this.nextRefresh = Date.now() + this.refreshMs;
    if (this.data.kind === "fresh") this.data = { ...this.data, kind: "stale" };
    const timer = setTimeout(() => controller.abort(), this.deadlineMs);
    void this.fetch(cwd, controller.signal).catch(() => UNAVAILABLE).then((result) => {
      clearTimeout(timer);
      if (this.pending !== controller) return;
      this.pending = null;
      this.nextRefresh = Date.now() + this.refreshMs;
      if (result.kind === "unavailable" && (this.data.kind === "fresh" || this.data.kind === "stale")) {
        this.data = { ...this.data, kind: "stale" };
      } else {
        this.data = result;
      }
      this.updateHandler?.();
    });
  }
}

const reader = new WorkspaceReader();
export const getWorkspaceData = (cwd: string | undefined): WorkspaceData => reader.read(cwd);
export const invalidateWorkspaceCache = (): void => reader.invalidate();
export const stopWorkspace = (): void => reader.stop();
export const setWorkspaceUpdateHandler = (handler: (() => void) | null): void => reader.onUpdate(handler);
