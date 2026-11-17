# pi-sidebar-tui

OpenCode-style sidebar TUI extension for [pi coding agent](https://github.com/earendil-works/pi).

Displays a real-time sidebar panel inside the pi terminal UI showing session metrics, todo tracking, workspace status, and connected MCP servers — inspired by [OpenCode](https://github.com/atanunny/opencode) sidebar.

## Features

### Session Panel
- Session title (auto-inferred from first user message with LLM fallback, or manually set)
- Session elapsed time (updated every 30 seconds)
- Active tool indicator with live elapsed timer
- Current model name with thinking level (`think:high`, `think:medium`, etc.)
- Context window usage: `tokens / max_window (pct%)` — fill bar colored by usage: green <50%, yellow 50–80%, red >80%
- Context estimate: `left ≈Nt` — turns remaining until the window fills at recent growth rate (`∞` when flat, `—` until enough data); colored muted ≥20t / accent 5–19t / warning red <5t
- Auto-compact status indicator
- Token input/output totals + session cost
- Cache hit percentage + turn count
- Live tokens-per-second (tok/s) via 2-second sliding window
- Session ID display
- Theme-aware colors (delegates to pi Theme API when available)

### MCP Servers Panel
- Connected MCP server status with connection indicators
- Tool count per server (direct/total)
- Token estimate per server

### Todos Panel
- Parses todo items from tool calls (`todo` tool)
- Status glyphs: `○` pending, `◐` in progress, `✓` completed
- Progress counter: `Todos (2/5)`
- Sub-action annotations for in-progress items

### Workspace Panel
- Git branch and ahead count when an upstream is available
- Up to 15 changed tracked files with diff stats (+N/-N), plus an omitted-file count
- Current working directory at bottom of sidebar
- Asynchronous refreshes with a 2-second total deadline and a 5-second cooldown
- No untracked-file enumeration, submodule inspection, or nested-repository discovery
- Loading, unavailable, and stale states instead of reporting failed scans as clean

## Installation

```bash
pi install npm:pi-sidebar-tui
```

The extension auto-registers via the `"pi"` field in `package.json`.

## Usage

The sidebar activates automatically when a session starts. Toggle visibility with:

```
/sidebar-tui on        # Enable sidebar
/sidebar-tui off       # Disable sidebar
/sidebar-tui width 45  # Set sidebar width (10-120)
/sidebar-tui todos 7   # Set the todos panel viewport height (1-100, default 7)
/sidebar-tui scroll 3  # Set keyboard scroll nudge size in lines (1-20, default 3)

/sidebar-scroll up      # Scroll the focused panel up one nudge
/sidebar-scroll down    # Scroll the focused panel down one nudge
/sidebar-scroll top     # Scroll the focused panel to the top
/sidebar-scroll bottom  # Scroll the focused panel to the bottom
/sidebar-scroll 10      # Scroll the focused panel by N lines

Ctrl+Shift+T            # Toggle sidebar on/off (rebind in ~/.pi/agent/keybindings.json)
Alt+Shift+Up / Down     # Scroll the focused panel up / down one nudge (Ctrl+Alt+Up / Down too)
Alt+PageUp / PageDown   # Scroll the focused panel a page (3x the nudge size)
```

The **Session** panel stays pinned at the top. The **Todos**, **MCP**, and **Workspace** panels each scroll **independently** when their content is taller than their own window (small terminal, or many todos / MCP servers / workspace files). Each scrolling panel shows `▲ N lines above` / `▼ N lines below` indicators; panels that fit render in full with no indicators. The scrollable panels share the available rows and fill down to the cwd row, so there's no dead blank band above it when the content is long enough (on a very short terminal the panels are squeezed down to fit, or clip, rather than pushing the whole sidebar off-screen).

**Scrolling:** the mouse wheel over a panel scrolls that panel (fullscreen mode only) and focuses it. The keyboard (`/sidebar-scroll`, `Alt+Shift+Up/Down`, `Alt+PageUp/Down`) scrolls the *focused* panel — the last one you scrolled with the mouse, or the first scrollable panel if you haven't yet.

Set custom session title:

```
/session-title "My feature implementation"
```

## Panel controls

Toggle each panel independently. Panel names are `session`, `mcp`, `todos`, and `workspace`.

```text
/sidebar-tui panel workspace off --project
/sidebar-tui panel workspace on --global
/sidebar-tui panel workspace inherit --project
```

Without a scope flag, commands change the global preference. A project override takes precedence, and the command notification reports the effective value. `inherit --project` removes that panel's project override.

Disabled panels occupy no rows or scroll targets. Disabling Workspace cancels its Git probes, and disabling MCP skips its sidebar data collection without disconnecting servers. Session-only timers stop while Session is hidden. Session and todo events remain tracked so re-enabling a panel shows current data. With all panels off, the cwd row remains; `/sidebar-tui off` releases the entire column.

## Configuration

Global settings live in `~/.pi/agent/sidebar-tui.json`, respecting `PI_CODING_AGENT_DIR` and `PI_SIDEBAR_CONFIG`. All panels default to enabled.

Project panel overrides live in `<project>/.pi/sidebar-tui.json`. The project is the Git root, or the session's starting directory outside Git. Repository subfolders share the root's settings. Resolution uses one bounded Git root lookup per cwd change, never a child-directory scan.

This project configuration disables Workspace and inherits every other panel:

```json
{
  "panels": {
    "workspace": false
  }
}
```

Precedence is project override, global preference, then built-in default. Missing or invalid panel values inherit. Commands apply immediately. After editing settings files manually, reload pi to apply them. Project files can be committed for shared defaults or ignored for personal preferences. Width, scrolling, and whole-sidebar visibility remain global settings.

### Workspace limits

Workspace inspects the repository containing the session cwd, not its siblings or nested repositories. Git runs asynchronously, ignores submodules, and disables rename detection, external diff helpers, filesystem-monitor hooks, and text conversion. Untracked files are not counted; the panel labels that scope explicitly.

Each refresh has a 2-second total deadline and a 256 KiB output limit per stream per subprocess. Only one refresh runs at a time. Repeated write events coalesce behind a 5-second cooldown; invalidated data refreshes after that cooldown even without another render. Disabling Workspace or the sidebar, changing cwd, and shutting down cancel pending workspace work.

Tracked-file inspection can still touch much of a large repository. These limits bound time and output, not the number of filesystem entries visited. On failure, the panel retains the previous snapshot with a stale label, or shows unavailable if no snapshot exists. A successful scan reports only whether tracked files are clean.


| Env var | Default | Description |
| --- | --- | --- |
| `PI_SIDEBAR_BG` | *(unset)* | Paint the sidebar with an opaque `#rrggbb` background. Unset (default) leaves the terminal background untouched so terminal transparency shows through. Set e.g. `PI_SIDEBAR_BG="#000000"` to hide scroll flash on opaque terminals. |
| `PI_SIDEBAR_SCROLL_SPEED` | `3` | Lines per keyboard scroll nudge (1-20). Overrides the persisted `scrollSpeed`; a page is 3x this. The mouse wheel uses the terminal's native scroll amount. |

## Requirements

- [pi coding agent](https://github.com/earendil-works/pi) >= 0.74.0
- [pi-tui](https://github.com/earendil-works/pi) >= 0.74.0

## Architecture

```
pi-sidebar-tui/
├── index.ts              # Extension entry point, event handlers, state management
├── sidebar.ts            # Main sidebar renderer (composes all panels)
├── compositor.ts         # Terminal compositor for right-column layout
├── colors.ts             # ANSI color helpers, formatting utilities
├── types.ts              # TypeScript type definitions
├── mcp.ts                # MCP server discovery and status
├── workspace.ts          # Bounded asynchronous Git workspace snapshots
├── panel-settings.ts     # Project panel overrides, root resolution, command parsing
├── panels/
│   ├── session.ts        # Session metrics panel
│   ├── todos.ts          # Todo tracking panel
│   ├── workspace.ts      # Git workspace status panel
│   └── mcp.ts            # MCP server status panel
├── tests/
│   ├── panels.test.ts    # Panel rendering tests
│   └── sidebar.test.ts   # Sidebar rendering tests
└── package.json
```

## How It Works

The extension hooks into pi's event system (`session_start`, `tool_call`, `message_end`, `turn_end`, etc.) to track state and renders a right-column sidebar using a custom `SidebarCompositor` that:

1. Narrows `terminal.columns` so pi renders main content in the left portion
2. Paints the sidebar in the rightmost columns after each pi render cycle
3. Uses synchronized output (`\x1b[?2026h`) to prevent rendering artifacts
4. Saves/restores cursor position (`DECSC`/`DECRC`) around paint

## Development

```bash
npm install
npm test
```

## Publish on npm

```bash
npm login
npm publish
```

## License

MIT
