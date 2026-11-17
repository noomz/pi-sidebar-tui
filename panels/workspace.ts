import { visibleWidth } from "@earendil-works/pi-tui";
import type { SidebarContext } from "../types.ts";
import { bold, dim, fg, COLORS, formatDiffStat, trunc } from "../colors.ts";
import type { WorkspaceFile } from "../types.ts";

function buildGitStatus(branch: string, ahead: number | null): string {
  let status = `⎇ ${branch}`;
  if (ahead !== null && ahead > 0) status += ` +${ahead}`;
  return status;
}

function renderWorkspaceHeader(ctx: SidebarContext, width: number): string[] {
  const left = bold(" Workspace");
  const leftPlain = " Workspace";

  const ws = ctx.workspace;
  if (ws.kind !== "fresh" && ws.kind !== "stale") {
    return [left, dim("─".repeat(Math.max(0, width)))];
  }

  const gitStatus = buildGitStatus(ws.branch, ws.aheadCount);
  const leftLen = visibleWidth(leftPlain);
  let rightLen = visibleWidth(gitStatus);
  const minPadding = 1;

  // If the right side is too long, truncate it
  let displayStatus = gitStatus;
  if (leftLen + minPadding + rightLen > width) {
    const maxStatusLen = Math.max(0, width - leftLen - minPadding);
    displayStatus = trunc(gitStatus, maxStatusLen);
  }

  rightLen = visibleWidth(displayStatus);
  const padding = Math.max(1, width - leftLen - rightLen);
  const headerLine = `${left}${" ".repeat(padding)}${dim(displayStatus)}`;

  return [headerLine, dim("─".repeat(Math.max(0, width)))];
}

const LEFT_PAD = 1; // gap between the sidebar's side border and the content

function renderFileLine(file: WorkspaceFile, width: number): string {
  const leftPad = " ".repeat(LEFT_PAD);
  const stat = formatDiffStat(file.added, file.removed);
  const statLen = visibleWidth(stat);
  const usable = Math.max(0, width - LEFT_PAD);
  const pathMax = Math.max(0, usable - statLen - 1);
  const path = trunc(file.path.replace(/[\x00-\x1f\x7f-\x9f]/g, "�"), pathMax);
  const pathLen = visibleWidth(path);
  const padding = Math.max(1, usable - pathLen - statLen);
  return `${leftPad}${path}${" ".repeat(padding)}${fg(COLORS.success, stat)}`;
}

export function renderWorkspacePanel(ctx: SidebarContext, width: number): string[] {
  const lines: string[] = [...renderWorkspaceHeader(ctx, width)];

  const ws = ctx.workspace;
  if (ws.kind !== "fresh" && ws.kind !== "stale") {
    const message = ws.kind === "not-repo" ? " (not a git repo)" : ws.kind === "loading" ? " (loading)" : " (scan unavailable)";
    lines.push(dim(trunc(message, width)));
    return lines;
  }

  if (ws.kind === "stale") lines.push(dim(trunc(" (stale snapshot)", width)));
  lines.push(dim(trunc(" Untracked/submodules: not scanned", width)));
  if (ws.files.length === 0) lines.push(dim(trunc(" (tracked files clean)", width)));
  for (const file of ws.files) lines.push(renderFileLine(file, width));
  if (ws.moreFiles > 0) lines.push(dim(trunc(` … +${ws.moreFiles} more files`, width)));
  return lines;
}
