# Sub-Agent Event Collapsing

## Overview

When a Copilot CLI session launches background agents (via the `task` tool), each agent generates
its own stream of child events — tool calls, assistant messages, reasoning, etc. In a typical
session these child events can account for **50–60 %** of all renderable events, creating massive
visual noise that buries the main conversation.

Sub-agent collapsing solves this by condensing each background agent's activity into a **single
status line** that live-updates during playback, similar to how the real Copilot CLI erases and
rewrites the current line as an agent works.

## How It Works

### 1. Identifying Sub-Agent Events

Every event in the JSONL file may carry a `data.parentToolCallId` field.  If present, the event
is a **child** of the tool call that launched a background agent.

```
isSubagentChild(ev)  →  Boolean
```

### 2. Building Sub-Agent Groups (`_buildSubagentGroups`)

During `load()`, the engine scans all renderable events and builds two data structures:

| Structure              | Type                          | Purpose                                       |
|------------------------|-------------------------------|-----------------------------------------------|
| `_subagentGroups`      | `{ [parentToolCallId]: { agentName, indices[] } }` | Maps each parent tool call to its agent name and the indices of all its child events |
| `_subagentChildIndices`| `Set<number>`                 | Fast O(1) lookup of whether a renderable index is a sub-agent child |

Agent names are resolved from two sources:
- **`subagent.started`** events — contain `data.agentName` directly
- **`task` tool calls** — the `agent_type` parameter from the tool's `input` JSON, combined with the `description` parameter

### 3. Status Line Generation (`subagentStatusLine`)

Each child event is reduced to a compact one-liner:

| Child Event Type          | Status Line Format                          |
|---------------------------|---------------------------------------------|
| `tool.execution_start`    | `🤖  AgentName ◌ toolName — truncated args` |
| `assistant.message`       | `🤖  AgentName ◌ thinking — content preview` |
| `tool.execution_complete` | *(null — skipped)*                          |
| Other types               | *(null — skipped)*                          |

The `◌` spinner character and dim styling give the visual impression of background work in progress.

### 4. Live Playback (Overwrite Animation)

During real-time playback (`_renderSingleEvent`), sub-agent child events **overwrite** the
previous line instead of appending a new one:

```
\x1b[2K\r   ← ANSI: clear entire line + carriage return
```

A `_lastWasSubagentChild` flag tracks whether the previous event was a sub-agent child:
- **If true:** emit `\x1b[2K\r` before the new status line (overwrite in place)
- **If false:** emit `\r\n` then `\x1b[2K\r` (start a new line, then overwrite)
- When transitioning **out** of a sub-agent group: emit `\r\n` to "close" the status line

This creates a smooth animation where each agent's status line flickers through its tool calls,
mimicking the real terminal experience.

### 5. Seek / Replay (Collapsed View)

When seeking via the scrubber (`_replayUpTo`), we don't animate — we just show the **final state**
of each agent at the target position:

1. Pre-compute `lastChildForGroup`: for each agent group, find the last child event ≤ target
   index that produces a non-null status line
2. During the replay loop, skip all child events **except** that last one
3. The result: each active agent group occupies exactly one line in the replayed output

### 6. Search Exclusion

The `EventSearcher` skips all events in `_subagentChildIndices` so that collapsed sub-agent
internals don't pollute search results.

## Data Flow Diagram

```
JSONL Load
    │
    ▼
_buildSubagentGroups()
    │
    ├── _subagentGroups: { parentToolCallId → { agentName, indices[] } }
    └── _subagentChildIndices: Set<number>
    
Live Playback                    Seek / Replay
    │                                │
    ▼                                ▼
_renderSingleEvent()             _replayUpTo(index)
    │                                │
    ├── isChild? ──yes──►            ├── pre-compute lastChildForGroup
    │   subagentStatusLine()         │   for each group
    │   + \x1b[2K\r overwrite       │
    │                                ├── loop events:
    └── isChild? ──no──►             │   ├── isChild & isLast? → render
        normal render                │   ├── isChild & !isLast? → skip
                                     │   └── !isChild → normal render
                                     │
                                     └── scrollToBottom()
```

## Edge Cases

- **Agents with no tool calls:** If an agent only produces `assistant.message` events, those
  are still collapsed with a "thinking" status line.
- **Multiple concurrent agents:** Each agent has its own `parentToolCallId`, so they collapse
  independently. During live playback, interleaved child events from different agents each
  overwrite their own status (the last-written line).
- **Snapshot boundaries:** When a snapshot falls inside a sub-agent group, replay from that
  snapshot correctly handles the partial group by only looking at child indices ≥ `startFrom`.
- **Filter changes:** Render cache invalidation recomputes sub-agent groups since renderable
  indices may shift when filters change.

## Configuration

The collapsing is automatic and cannot be toggled off in the current implementation. To disable
it, remove the `_subagentChildIndices` check in `_renderSingleEvent()` and `_replayUpTo()`.
