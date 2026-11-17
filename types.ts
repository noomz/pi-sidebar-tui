export type PanelId = "session" | "mcp" | "todos" | "workspace";
export type PanelSettings = Record<PanelId, boolean>;

export type TodoStatus = "pending" | "in_progress" | "completed";

export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
  subAction?: string;
}

export type WorkspaceData =
  | { kind: "loading" | "unavailable" | "not-repo" }
  | { kind: "fresh" | "stale"; branch: string; aheadCount: number | null; files: WorkspaceFile[]; moreFiles: number };

export interface WorkspaceFile {
  path: string;
  added: number;
  removed: number;
}

export interface McpServerInfo {
  name: string;
  directCount: number;
  totalCount: number;
  tokenEstimate: number;
  connected: boolean;
  disabled: boolean;
}

export interface CtxSample {
  tokens: number;
  turns: number;
}

export type CtxLeft =
  | { kind: "unknown" }
  | { kind: "stable" }
  | { kind: "left"; turns: number };

export interface SidebarContext {
  panels: PanelSettings;
  sessionTitle: string | null;
  sessionId: string | null;
  todos: TodoItem[];
  todosMax: number;
  workspace: WorkspaceData;
  cwd: string | undefined;
  model: string | null;
  thinkingLevel: string | null;
  contextTokens: number | null;
  contextPercent: number | null;
  contextWindow: number | null;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheWrite: number;
  sessionCost: number;
  turnCount: number;
  activeTool: { name: string; startedAt: number } | null;
  autoCompactEnabled: boolean | null;
  sessionStartMs: number;
  mcpServers: McpServerInfo[];
  modelProvider: string | null;
  cavemanLevel: string | null;
  cavemanFrame: number;
  agentActive: boolean;
  spinnerFrame: number;
  liveTps: number | null;
  lastTps: number | null;
  lastTurnMs: number | null;
  ctxSamples: CtxSample[];
}
