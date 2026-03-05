# Copilot Session Explorer

> **[Live Demo](https://mitsha-microsoft.github.io/copilot-session-explorer/)** — drop any `.jsonl` session file to try it

A terminal-style session history viewer built with [xterm.js](https://xtermjs.org/). It plays back `.jsonl` session files from Copilot CLI (or similar terminal AI agents) with distinct visual styling per event type, playback controls, timeline scrubbing, search, and event filtering.

![Screenshot](https://img.shields.io/badge/xterm.js-v5.5-blue)

## Getting Your Session File

1. In your **Copilot CLI** terminal session, type the `/session` slash command
2. The output will display the session directory path containing an `events.jsonl` file
3. Load that file into the explorer via drag & drop, the file picker, or by placing it alongside `index.html`

```
> /session
Session ID: abc-123-def
Session directory: ~/.copilot/sessions/abc-123-def/
```

Copy the `events.jsonl` from that directory and you're ready to go.

## Quick Start

### Option 1 — Python (simplest)

```bash
cd SessionRenderer
python -m http.server 8080
```

Then open **http://localhost:8080** in your browser.

### Option 2 — Node.js

```bash
npx serve .
```

### Option 3 — Any Static Server

Serve the directory with any HTTP server (Caddy, nginx, VS Code Live Server extension, etc.). The app is purely static — no build step required.

> **Note:** You must serve via HTTP (not `file://`) because the app fetches `events.jsonl` and loads ES modules from CDN.

## Usage

1. **Auto-load** — If `events.jsonl` is in the same directory, it loads automatically on page open.
2. **Manual load** — Click **📂 Load Session** or drag-and-drop any `.jsonl` file onto the page.
3. **Play** — Press **Space** or click **▶** to start playback.
4. **Navigate** — Use **→** / **←** to step forward/backward one event at a time.
5. **Jump turns** — Use **Shift+→** / **Shift+←** to jump between user messages.
6. **Timeline** — Drag the scrubber bar to seek to any point. Cyan markers = user messages, red = errors.
7. **Speed** — Drag the speed slider or press **↑** / **↓** to change playback speed (1×–50×).
8. **Filter** — Toggle **⚙ Tools**, **💭 Think**, and **ℹ Sys** buttons to show/hide event categories.
9. **Search** — Press **F** to open the search bar. Type a query and press **Enter** to jump between matches.
10. **Restart** — Press **R** or click **⏹** to reset.

## Keyboard Shortcuts

Press **?** at any time to see this in-app.

| Key | Action |
|-----|--------|
| `Space` | Play / Pause |
| `→` | Next event |
| `←` | Previous event |
| `Shift+→` | Next user message |
| `Shift+←` | Previous user message |
| `↑` | Increase speed |
| `↓` | Decrease speed |
| `R` | Restart |
| `T` | Toggle tool events |
| `Y` | Toggle reasoning |
| `I` | Toggle system info |
| `F` | Open search |
| `?` | Show keyboard shortcuts |
| `Esc` | Close overlay / search |

## Event Types & Styling

Each event type has its own visual style defined in the `STYLE_MAP` object in `app.js`. You can customise colours, icons, and formatting by editing that map.

| Event Type | Visual Style | Category |
|------------|-------------|----------|
| `session.start` | Blue bordered banner with session metadata | — |
| `session.resume` | Blue with resume timestamp | system |
| `session.info` | Dim blue with info icon | system |
| `session.error` | Bright red with ✖ icon | — |
| `session.model_change` | Magenta with 🔄 icon | system |
| `session.compaction_*` | Dim yellow with progress indicator | system |
| `user.message` | Bright cyan with ❯ prompt | — |
| `assistant.message` | White text; reasoning as dim italic gray | reasoning* |
| `assistant.turn_start/end` | Dim gray separator lines | — |
| `tool.execution_start` | Tool-specific rendering (see below) | tools |
| `tool.execution_complete` | Tool-specific result rendering | tools |
| `tool.user_requested` | Yellow italic with 👤 icon | tools |
| `subagent.started` | Bold magenta with agent name | — |
| `subagent.completed` | Magenta with ✔ icon | — |

*\* The reasoning filter only hides the reasoning/thinking portion of assistant messages, not the main content.*

### Tool-Specific Rendering

Tool calls are rendered with specialized formatting per tool name via `TOOL_START_RENDERERS` and `TOOL_COMPLETE_RENDERERS` in `app.js`:

| Tool | Start Rendering | Complete Rendering |
|------|-----------------|-------------------|
| `powershell` | `$ command` with description comment | Output preview or exit status |
| `view` | `👁 view path` with shortened path | `(viewed)` — content suppressed |
| `edit` | `✏ replace in path` | Confirmation message |
| `create` | `+ create path` | Confirmation message |
| `grep` / `rg` | `🔍 grep /pattern/ in path` | Result count + file preview |
| `glob` | `📂 glob pattern` | File count or file list |
| `task` | `🤖 agent:type [model] (mode)` with description | Agent completion + brief result |
| `read_agent` | `◂ reading agent result` | Brief result preview |
| `web_fetch` | `🌐 fetch url` | Brief content preview |
| `web_search` | `🔎 search "query"` | Brief result preview |
| `sql` | `🗄 sql — description` with query preview | Query result |
| `ask_user` | `💬 ask_user: question` | User's answer |
| `task_complete` | `🏁 task_complete` with summary | Completion confirmation |
| `report_intent` | `🎯 Intent: text` | (suppressed) |

Paths are automatically shortened to the last 3 segments for readability (e.g., `…\src\components\App.tsx`).

## Customising Styles

Open `app.js` and find the `STYLE_MAP` object near the top. Each key is an event type and the value is a function that receives the raw event and returns a styled string using ANSI escape codes.

The `ansi` helper object provides:

```js
ansi.bold(text)
ansi.dim(text)
ansi.italic(text)
ansi.fg.cyan(text)        // Standard colours
ansi.fg.brightCyan(text)  // Bright colours
ansi.fg.gray(text)        // Gray (bright black)
ansi.bg.blue(text)        // Background colours
```

### Example: Change user message colour to green

```js
'user.message': (ev) => {
  const text = ev.data.content || '';
  return ansi.bold(ansi.fg.brightGreen('❯ USER')) + '\r\n' +
         ansi.fg.green(`  ${text}`);
},
```

### Customising Playback Timing

Edit the `BASE_DELAYS` object in `app.js` to change per-event-type delays (in milliseconds):

```js
const BASE_DELAYS = {
  'user.message': 1200,     // longer pause for user messages
  'tool.execution_start': 200,  // fast for tool events
  // ...
};
```

### Customising Filters

Edit the `EVENT_CATEGORIES` object to change which events belong to which filter category.

## Terminal Theme

The xterm.js terminal theme (background, foreground, colour palette) is configured in the `term` constructor in `app.js`. It uses a **Tokyo Night** inspired palette by default. Modify the `theme` object to change it.

## Performance

The renderer uses several optimisations for large sessions (10K+ events):
- **Snapshot cache**: Terminal state is cached every 200 events, so seeking backward only replays from the nearest snapshot.
- **Batched rendering**: All output for a replay is collected into a single `term.write()` call.
- **Batched playback**: At speeds ≥10×, multiple events are rendered per animation tick.
- **Render cache**: Per-event rendered output is cached and invalidated only when filters change.

## File Structure

```
SessionRenderer/
├── index.html       # Main page (loads xterm.js from CDN)
├── app.js           # Core logic: parser, renderer, playback engine
├── styles.css       # Layout and control styling
├── events.jsonl     # Session data (your file)
└── README.md        # This file
```

## JSONL Format

Each line is a JSON object with at minimum:

```json
{
  "type": "event.type",
  "data": { ... },
  "id": "uuid",
  "timestamp": "ISO-8601",
  "parentId": "uuid | null"
}
```

The renderer handles all standard Copilot CLI event types. Unknown types are silently skipped.

## Browser Requirements

- Modern browser with ES2020+ support (Chrome, Edge, Firefox, Safari)
- JavaScript enabled
- Internet connection (for xterm.js CDN) — or self-host the libraries
