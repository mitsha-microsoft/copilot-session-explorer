/**
 * Session Renderer – app.js
 *
 * Plays back a Copilot CLI .jsonl session file inside an xterm.js terminal,
 * with per-event-type styling and playback controls.
 */

/* ================================================================
   ANSI helpers
   ================================================================ */
const ESC = '\x1b[';
const RESET = `${ESC}0m`;

const ansi = {
  bold:       s => `${ESC}1m${s}${RESET}`,
  dim:        s => `${ESC}2m${s}${RESET}`,
  italic:     s => `${ESC}3m${s}${RESET}`,
  underline:  s => `${ESC}4m${s}${RESET}`,
  fg: {
    black:   s => `${ESC}30m${s}${RESET}`,
    red:     s => `${ESC}31m${s}${RESET}`,
    green:   s => `${ESC}32m${s}${RESET}`,
    yellow:  s => `${ESC}33m${s}${RESET}`,
    blue:    s => `${ESC}34m${s}${RESET}`,
    magenta: s => `${ESC}35m${s}${RESET}`,
    cyan:    s => `${ESC}36m${s}${RESET}`,
    white:   s => `${ESC}37m${s}${RESET}`,
    brightRed:     s => `${ESC}91m${s}${RESET}`,
    brightGreen:   s => `${ESC}92m${s}${RESET}`,
    brightYellow:  s => `${ESC}93m${s}${RESET}`,
    brightBlue:    s => `${ESC}94m${s}${RESET}`,
    brightMagenta: s => `${ESC}95m${s}${RESET}`,
    brightCyan:    s => `${ESC}96m${s}${RESET}`,
    brightWhite:   s => `${ESC}97m${s}${RESET}`,
    gray:    s => `${ESC}90m${s}${RESET}`,
  },
  bg: {
    black:   s => `${ESC}40m${s}${RESET}`,
    red:     s => `${ESC}41m${s}${RESET}`,
    green:   s => `${ESC}42m${s}${RESET}`,
    yellow:  s => `${ESC}43m${s}${RESET}`,
    blue:    s => `${ESC}44m${s}${RESET}`,
    magenta: s => `${ESC}45m${s}${RESET}`,
  },
};

/* ================================================================
   Event categories — used for filtering
   ================================================================ */
const EVENT_CATEGORIES = {
  'tool.execution_start': 'tools',
  'tool.execution_complete': 'tools',
  'tool.user_requested': 'tools',
  'session.info': 'system',
  'session.compaction_start': 'system',
  'session.compaction_complete': 'system',
  'session.model_change': 'system',
  'session.resume': 'system',
};

/* ================================================================
   Playback timing — base delays per event type (ms)
   ================================================================ */
const BASE_DELAYS = {
  'user.message': 1200,
  'assistant.message': 800,
  'assistant.turn_start': 400,
  'assistant.turn_end': 300,
  'tool.execution_start': 200,
  'tool.execution_complete': 200,
  'session.start': 1500,
  'session.info': 300,
  'session.error': 800,
  'session.model_change': 600,
  'session.resume': 800,
  'session.compaction_start': 300,
  'session.compaction_complete': 500,
  'subagent.started': 600,
  'subagent.completed': 400,
  'tool.user_requested': 400,
};

/* ================================================================
   Tool-specific renderers for tool.execution_start
   Each returns styled string lines or null to skip.
   ================================================================ */
const TOOL_START_RENDERERS = {

  /* ── Shell commands ─────────────────────────────────────────── */
  'powershell': (args) => {
    const cmd = args.command || '';
    const desc = args.description || '';
    const lines = [];
    lines.push(ansi.bold(ansi.fg.brightYellow('  $ ')) + ansi.fg.brightWhite(truncate(cmd, 120)));
    if (desc) lines.push(ansi.dim(ansi.fg.gray(`    # ${desc}`)));
    return lines.join('\r\n');
  },

  'read_powershell': (args) => {
    return ansi.dim(ansi.fg.yellow(`  ◂ reading shell output…`));
  },

  'write_powershell': (args) => {
    const input = args.input || '';
    return ansi.fg.yellow(`  ▸ shell input: `) + ansi.fg.brightWhite(truncate(input, 80));
  },

  'stop_powershell': (args) => {
    return ansi.dim(ansi.fg.yellow(`  ■ stopping shell`));
  },

  'list_powershell': (_args) => {
    return ansi.dim(ansi.fg.yellow(`  ◆ listing shell sessions`));
  },

  /* ── File operations ────────────────────────────────────────── */
  'view': (args) => {
    const path = args.path || '';
    const range = args.view_range ? ` [${args.view_range.join('-')}]` : '';
    return ansi.fg.cyan(`  👁  view `) + ansi.fg.brightCyan(shortenPath(path)) + ansi.dim(ansi.fg.cyan(range));
  },

  'edit': (args) => {
    const path = args.path || '';
    const hasNew = !!args.new_str;
    const hasOld = !!args.old_str;
    const label = hasNew && hasOld ? 'replace in' : hasNew ? 'insert into' : 'edit';
    return ansi.fg.brightGreen(`  ✏  ${label} `) + ansi.fg.brightGreen(shortenPath(path));
  },

  'create': (args) => {
    const path = args.path || '';
    return ansi.fg.brightGreen(`  +  create `) + ansi.fg.brightGreen(shortenPath(path));
  },

  /* ── Search tools ───────────────────────────────────────────── */
  'grep': (args) => {
    const pattern = args.pattern || '';
    const path = args.path ? shortenPath(args.path) : '.';
    const glob = args.glob ? ` (${args.glob})` : '';
    return ansi.fg.yellow(`  🔍  grep `) + ansi.fg.brightWhite(`/${pattern}/`) +
           ansi.dim(ansi.fg.yellow(` in ${path}${glob}`));
  },

  'rg': (args) => {
    const pattern = args.pattern || args.query || '';
    const path = args.path ? shortenPath(args.path) : '.';
    return ansi.fg.yellow(`  🔍  rg `) + ansi.fg.brightWhite(`/${pattern}/`) +
           ansi.dim(ansi.fg.yellow(` in ${path}`));
  },

  'glob': (args) => {
    const pattern = args.pattern || '';
    const path = args.path ? shortenPath(args.path) : '.';
    return ansi.fg.yellow(`  📂  glob `) + ansi.fg.brightWhite(pattern) +
           ansi.dim(ansi.fg.yellow(` in ${path}`));
  },

  /* ── Sub-agent invocation ───────────────────────────────────── */
  'task': (args) => {
    const agentType = args.agent_type || 'unknown';
    const desc = args.description || '';
    const model = args.model || '';
    const mode = args.mode === 'background' ? ' (background)' : '';
    const lines = [];
    lines.push(
      ansi.bold(ansi.fg.brightMagenta(`  🤖  agent:${agentType}`)) +
      (model ? ansi.dim(ansi.fg.magenta(` [${model}]`)) : '') +
      ansi.dim(ansi.fg.magenta(mode))
    );
    if (desc) lines.push(ansi.fg.magenta(`     ${desc}`));
    return lines.join('\r\n');
  },

  'read_agent': (args) => {
    const wait = args.wait ? ' (waiting)' : '';
    return ansi.dim(ansi.fg.magenta(`  ◂ reading agent result${wait}`));
  },

  /* ── Web tools ──────────────────────────────────────────────── */
  'web_fetch': (args) => {
    const url = args.url || '';
    return ansi.fg.blue(`  🌐 fetch `) + ansi.underline(ansi.fg.brightBlue(truncate(url, 100)));
  },

  'web_search': (args) => {
    const query = args.query || '';
    return ansi.fg.blue(`  🔎 search `) + ansi.fg.brightWhite(`"${truncate(query, 90)}"`);
  },

  /* ── SQL ────────────────────────────────────────────────────── */
  'sql': (args) => {
    const desc = args.description || '';
    const query = args.query || '';
    const preview = truncate(query, 80);
    const lines = [];
    lines.push(ansi.fg.cyan(`  🗄  sql`) + (desc ? ansi.dim(ansi.fg.cyan(` — ${desc}`)) : ''));
    if (preview) lines.push(ansi.dim(ansi.fg.gray(`     ${preview}`)));
    return lines.join('\r\n');
  },

  /* ── User interaction ───────────────────────────────────────── */
  'ask_user': (args) => {
    const question = truncate(args.question || '', 120);
    return ansi.fg.brightCyan(`  💬  ask_user: `) + ansi.fg.white(question);
  },

  /* ── Completion ─────────────────────────────────────────────── */
  'task_complete': (args) => {
    const summary = truncate(args.summary || '', 120);
    return ansi.bold(ansi.fg.brightGreen(`  🏁 task_complete`)) +
           (summary ? '\r\n' + ansi.fg.green(`     ${summary}`) : '');
  },

  /* ── Intent (already handled but listed for completeness) ──── */
  'report_intent': (args) => {
    const intent = args.intent;
    if (intent) return ansi.fg.brightMagenta(`  🎯  Intent: ${intent}`);
    return null;
  },

  'update_todo': (args) => {
    return ansi.dim(ansi.fg.gray(`  ☑  update_todo`));
  },
};

/* ── Tool-specific renderers for tool.execution_complete ──────── */
const TOOL_COMPLETE_RENDERERS = {

  // View: suppress completion entirely (start already shows the path)
  'view': (_d) => null,

  // Shell: show output preview (potentially interesting)
  'powershell': (d) => {
    if (d.success) {
      const preview = truncate(d.result?.content || '', 200);
      if (!preview) return ansi.dim(ansi.fg.green('  ✔  (exit 0)'));
      return ansi.fg.green(`  ✔  `) + ansi.dim(ansi.fg.white(preview));
    }
    const err = truncate(d.result?.content || 'failed', 200);
    return ansi.fg.brightRed(`  ✖  ${err}`);
  },

  // Edit: just show confirmation
  'edit': (d) => {
    if (d.success) {
      const msg = truncate(d.result?.content || 'updated', 120);
      return ansi.fg.green(`  ✔  ${msg}`);
    }
    return ansi.fg.brightRed(`  ✖  ${truncate(d.result?.content || 'failed', 120)}`);
  },

  // Create: show confirmation
  'create': (d) => {
    if (d.success) {
      const msg = truncate(d.result?.content || 'created', 120);
      return ansi.fg.green(`  ✔  ${msg}`);
    }
    return ansi.fg.brightRed(`  ✖  ${truncate(d.result?.content || 'failed', 120)}`);
  },

  // Task (agent): show brief result
  'task': (d) => {
    if (d.success) {
      const preview = truncate(d.result?.content || '', 150);
      if (!preview) return ansi.fg.magenta('  ✔  agent completed');
      return ansi.fg.magenta('  ✔  agent completed: ') + ansi.dim(ansi.fg.white(preview));
    }
    return ansi.fg.brightRed(`  ✖  agent failed: ${truncate(d.result?.content || 'error', 120)}`);
  },

  // Read agent: show brief result
  'read_agent': (d) => {
    if (d.success) {
      const preview = truncate(d.result?.content || '', 150);
      if (!preview) return ansi.dim(ansi.fg.magenta('  ✔  agent result received'));
      return ansi.fg.magenta('  ✔  ') + ansi.dim(ansi.fg.white(preview));
    }
    return ansi.fg.brightRed(`  ✖  ${truncate(d.result?.content || 'failed', 120)}`);
  },

  // Grep/glob: show file list or count
  'grep': (d) => {
    if (d.success) {
      const content = d.result?.content || '';
      const lineCount = content.split('\n').filter(l => l.trim()).length;
      if (lineCount > 3) {
        const first3 = content.split('\n').filter(l => l.trim()).slice(0, 3).map(l => shortenPath(l.trim()));
        return ansi.fg.green(`  ✔  ${lineCount} results: `) + ansi.dim(ansi.fg.white(first3.join(', ') + '…'));
      }
      return ansi.fg.green(`  ✔  ${truncate(content, 150)}`);
    }
    return ansi.fg.brightRed(`  ✖  ${truncate(d.result?.content || 'no matches', 120)}`);
  },

  'rg': (d) => TOOL_COMPLETE_RENDERERS['grep'](d),

  'glob': (d) => {
    if (d.success) {
      const content = d.result?.content || '';
      const files = content.split('\n').filter(l => l.trim());
      if (files.length > 3) {
        return ansi.fg.green(`  ✔  ${files.length} files found`);
      }
      return ansi.fg.green(`  ✔  ${files.map(f => shortenPath(f.trim())).join(', ') || '(none)'}`);
    }
    return ansi.fg.brightRed(`  ✖  ${truncate(d.result?.content || 'failed', 120)}`);
  },

  // Web: show brief preview
  'web_fetch': (d) => {
    if (d.success) {
      const preview = truncate(d.result?.content || '', 120);
      return ansi.fg.blue(`  ✔  `) + ansi.dim(ansi.fg.white(preview || '(fetched)'));
    }
    return ansi.fg.brightRed(`  ✖  ${truncate(d.result?.content || 'fetch failed', 120)}`);
  },

  'web_search': (d) => {
    if (d.success) {
      const preview = truncate(d.result?.content || '', 120);
      return ansi.fg.blue(`  ✔  `) + ansi.dim(ansi.fg.white(preview || '(results)'));
    }
    return ansi.fg.brightRed(`  ✖  ${truncate(d.result?.content || 'search failed', 120)}`);
  },

  // SQL: brief confirmation
  'sql': (d) => {
    if (d.success) {
      const preview = truncate(d.result?.content || 'ok', 120);
      return ansi.fg.cyan(`  ✔  ${preview}`);
    }
    return ansi.fg.brightRed(`  ✖  ${truncate(d.result?.content || 'query failed', 120)}`);
  },

  // Ask user: show selected answer
  'ask_user': (d) => {
    if (d.success) {
      const answer = truncate(d.result?.content || '', 120);
      return ansi.fg.brightCyan(`  ↩  ${answer}`);
    }
    return ansi.fg.brightRed(`  ✖  (no response)`);
  },

  // Quiet tools
  'report_intent': (_d) => null,
  'update_todo': (d) => d.success ? ansi.dim(ansi.fg.gray('  ✔  todos updated')) : null,
  'read_powershell': (d) => {
    if (d.success) {
      const preview = truncate(d.result?.content || '', 150);
      if (!preview) return ansi.dim(ansi.fg.yellow('  ✔  (no output)'));
      return ansi.fg.green(`  ✔  `) + ansi.dim(ansi.fg.white(preview));
    }
    return ansi.fg.brightRed(`  ✖  ${truncate(d.result?.content || 'failed', 120)}`);
  },
  'stop_powershell': (d) => d.success ? ansi.dim(ansi.fg.yellow('  ✔  shell stopped')) : null,
  'list_powershell': (d) => {
    const preview = truncate(d.result?.content || '', 120);
    return ansi.dim(ansi.fg.yellow(`  ✔  ${preview || '(no sessions)'}`));
  },
  'task_complete': (d) => {
    if (d.success) return ansi.bold(ansi.fg.brightGreen('  ✔  Task marked complete'));
    return null;
  },
};

/* ── Path shortening helper ───────────────────────────────────── */
function shortenPath(p) {
  if (!p) return '';
  // Show last 2-3 path segments for readability
  const sep = p.includes('/') ? '/' : '\\';
  const parts = p.split(sep).filter(Boolean);
  if (parts.length <= 3) return p;
  return '…' + sep + parts.slice(-3).join(sep);
}

/* ================================================================
   Style map – one entry per event type.
   Each value is a function: (event, filters) => string | null.
   Customise colours/formatting here.
   ================================================================ */
const STYLE_MAP = {

  /* ── Session lifecycle ──────────────────────────────────────── */

  'session.start': (ev) => {
    const d = ev.data;
    const ctx = d.context || {};
    const lines = [
      '',
      ansi.bold(ansi.fg.brightBlue('╔══════════════════════════════════════════════════════════╗')),
      ansi.bold(ansi.fg.brightBlue('║')) + ansi.bold(ansi.fg.brightWhite('  SESSION START')) + ansi.bold(ansi.fg.brightBlue('                                          ║')),
      ansi.bold(ansi.fg.brightBlue('╚══════════════════════════════════════════════════════════╝')),
      ansi.fg.blue(`  Session : ${d.sessionId || '?'}`),
      ansi.fg.blue(`  Agent   : ${d.producer || '?'}  v${d.copilotVersion || '?'}`),
      ansi.fg.blue(`  Time    : ${d.startTime || ev.timestamp}`),
    ];
    if (ctx.cwd)    lines.push(ansi.fg.blue(`  CWD     : ${ctx.cwd}`));
    if (ctx.branch) lines.push(ansi.fg.blue(`  Branch  : ${ctx.branch}`));
    lines.push('');
    return lines.join('\r\n');
  },

  'session.resume': (ev) => {
    const d = ev.data;
    const ctx = d.context || {};
    return [
      '',
      ansi.fg.blue(`⟳  Session resumed at ${d.resumeTime || ev.timestamp}  (${d.eventCount || '?'} events)`),
      ctx.branch ? ansi.fg.blue(`   Branch: ${ctx.branch}`) : '',
      '',
    ].filter(Boolean).join('\r\n');
  },

  'session.info': (ev) => {
    const d = ev.data;
    return ansi.dim(ansi.fg.blue(`ℹ  [${d.infoType || 'info'}] ${d.message}`));
  },

  'session.model_change': (ev) => {
    return ansi.fg.magenta(`🔄 Model changed → ${ansi.bold(ev.data.newModel)}`);
  },

  'session.error': (ev) => {
    return ansi.fg.brightRed(`✖  ERROR [${ev.data.errorType || 'unknown'}]: ${ev.data.message}`);
  },

  'session.compaction_start': (_ev) => {
    return ansi.dim(ansi.fg.yellow('⏳ Context compaction started…'));
  },

  'session.compaction_complete': (ev) => {
    const d = ev.data;
    if (d.success) {
      return ansi.dim(ansi.fg.yellow(
        `✓  Compaction complete — ${d.preCompactionTokens?.toLocaleString() || '?'} tokens, ` +
        `${d.preCompactionMessagesLength || '?'} messages → checkpoint #${d.checkpointNumber ?? '?'}`
      ));
    }
    return ansi.fg.brightRed('✖  Compaction failed');
  },

  /* ── User messages ──────────────────────────────────────────── */

  'user.message': (ev) => {
    const text = ev.data.content || '';
    const wrapped = wordWrap(text, 100);
    const lines = [
      '',
      ansi.bold(ansi.fg.brightCyan('❯ USER')),
      ...wrapped.map(l => ansi.fg.brightCyan(`  ${l}`)),
      '',
    ];
    return lines.join('\r\n');
  },

  /* ── Assistant messages ─────────────────────────────────────── */

  'assistant.turn_start': (ev) => {
    return [
      '',
      ansi.dim(ansi.fg.gray(`── turn ${ev.data.turnId} ${'─'.repeat(50)}`)),
    ].join('\r\n');
  },

  'assistant.turn_end': (_ev) => {
    return ansi.dim(ansi.fg.gray('─'.repeat(64)));
  },

  'assistant.message': (ev, filters) => {
    const d = ev.data;
    const parts = [];

    // Reasoning (thinking) — respect filter
    if (d.reasoningText && filters.reasoning) {
      parts.push('');
      parts.push(ansi.italic(ansi.fg.blue('💭  Thinking…')));
      const rLines = wordWrap(d.reasoningText, 100);
      for (const l of rLines) {
        parts.push(ansi.italic(ansi.fg.blue(`   ${l}`)));
      }
    }

    // Main content
    const content = (d.content || '').trim();
    if (content) {
      parts.push('');
      parts.push(ansi.bold(ansi.fg.brightWhite('🤖  ASSISTANT')));
      const cLines = formatContent(content, 100);
      for (const l of cLines) {
        // Table lines from formatContent already contain ANSI escapes
        if (l.includes('\x1b[')) {
          parts.push(`  ${l}`);
        } else {
          parts.push(ansi.fg.white(`  ${l}`));
        }
      }
    }

    // Tool requests — use specialized renderers
    if (d.toolRequests && d.toolRequests.length > 0) {
      const meaningful = d.toolRequests.filter(t => t.name !== 'report_intent');
      if (meaningful.length > 0) {
        parts.push('');
        parts.push(ansi.fg.yellow(`  📎 Tool calls (${meaningful.length}):`));
        for (const tr of meaningful) {
          const renderer = TOOL_START_RENDERERS[tr.name];
          if (renderer) {
            const rendered = renderer(tr.arguments || {});
            if (rendered) parts.push(rendered);
          } else {
            const argStr = summariseArgs(tr.arguments);
            parts.push(ansi.fg.yellow(`     ▸ ${tr.name}`) + ansi.dim(ansi.fg.yellow(argStr ? ` — ${argStr}` : '')));
          }
        }
      }
    }

    if (parts.length === 0) return null;
    parts.push('');
    return parts.join('\r\n');
  },

  /* ── Tool events ────────────────────────────────────────────── */

  'tool.execution_start': (ev) => {
    const d = ev.data;
    const renderer = TOOL_START_RENDERERS[d.toolName];
    if (renderer) {
      return renderer(d.arguments || {});
    }
    // Fallback for unknown tools
    const argStr = summariseArgs(d.arguments);
    return ansi.fg.yellow(`  ⚙  ${d.toolName}`) + (argStr ? ansi.dim(ansi.fg.yellow(` — ${argStr}`)) : '');
  },

  'tool.execution_complete': (ev) => {
    const d = ev.data;
    // Look up tool name from correlation map
    const toolName = _toolCallIdMap[d.toolCallId];
    if (toolName) {
      const renderer = TOOL_COMPLETE_RENDERERS[toolName];
      if (renderer) {
        const result = renderer(d);
        if (result !== null && result !== undefined) return result;
        return null; // explicitly suppressed
      }
    }
    // Fallback
    if (d.success) {
      const preview = truncate(d.result?.content || '', 200);
      if (!preview) return ansi.fg.green('  ✔  (done)');
      return ansi.fg.green(`  ✔  ${preview}`);
    }
    const errMsg = truncate(d.result?.content || d.error || 'failed', 200);
    return ansi.fg.brightRed(`  ✖  ${errMsg}`);
  },

  'tool.user_requested': (ev) => {
    const d = ev.data;
    // Skip local_shell — user typing in their own terminal
    if (d.toolName === 'local_shell') return null;
    const renderer = TOOL_START_RENDERERS[d.toolName];
    if (renderer) {
      return ansi.italic(ansi.fg.yellow('  👤  User-requested: ')) + '\r\n' + renderer(d.arguments || {});
    }
    const argStr = summariseArgs(d.arguments);
    return ansi.italic(ansi.fg.yellow(`  👤  User-requested tool: ${d.toolName}${argStr ? ' — ' + argStr : ''}`));
  },

  /* ── Sub-agents ─────────────────────────────────────────────── */

  'subagent.started': (ev) => {
    const d = ev.data;
    return [
      '',
      ansi.bold(ansi.fg.brightMagenta(`  🤖  Sub-agent started: ${d.agentDisplayName || d.agentName}`)),
      d.agentDescription ? ansi.dim(ansi.fg.magenta(`     ${truncate(d.agentDescription.trim(), 120)}`)) : '',
    ].filter(Boolean).join('\r\n');
  },

  'subagent.completed': (ev) => {
    const d = ev.data;
    return ansi.fg.magenta(`  ✔  Sub-agent completed: ${d.agentDisplayName || d.agentName}`);
  },
};

/* ================================================================
   Utility helpers
   ================================================================ */

function truncate(s, max) {
  if (!s) return '';
  const oneLine = s.replace(/[\r\n]+/g, ' ').trim();
  if (oneLine.length <= max) return oneLine;
  return oneLine.slice(0, max - 1) + '…';
}

function summariseArgs(args) {
  if (!args) return '';
  const keys = ['path', 'command', 'description', 'pattern', 'query', 'intent', 'url', 'prompt'];
  for (const k of keys) {
    if (args[k]) return truncate(String(args[k]), 80);
  }
  for (const [, v] of Object.entries(args)) {
    if (typeof v === 'string' && v.length > 0) return truncate(v, 80);
  }
  return '';
}

function wordWrap(text, maxWidth) {
  if (maxWidth <= 0) return [text];
  const lines = [];
  for (const raw of text.split(/\r?\n/)) {
    if (raw.length <= maxWidth) {
      lines.push(raw);
      continue;
    }
    let remaining = raw;
    while (remaining.length > maxWidth) {
      let idx = remaining.lastIndexOf(' ', maxWidth);
      if (idx <= 0) idx = maxWidth;
      lines.push(remaining.slice(0, idx));
      remaining = remaining.slice(idx).trimStart();
    }
    if (remaining) lines.push(remaining);
  }
  return lines;
}

/* ================================================================
   Markdown table → box-drawing table formatter
   ================================================================ */

/**
 * Detect whether a line is a markdown table separator (e.g. |---|---|)
 */
function isTableSeparator(line) {
  return /^\|[\s:]*-+[\s:]*(\|[\s:]*-+[\s:]*)*\|?\s*$/.test(line.trim());
}

/**
 * Parse cells from a markdown table row.  Strips leading/trailing pipes and
 * trims each cell.
 */
function parseTableRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map(c => c.trim());
}

/**
 * Render a parsed markdown table as box-drawing lines with ANSI styling.
 * Returns an array of styled strings (one per output line).
 *
 *   ┌────────┬────────────┐
 *   │ Header │ Header 2   │   ← bold cyan
 *   ├────────┼────────────┤
 *   │ cell   │ cell 2     │   ← white
 *   └────────┴────────────┘
 */
function renderBoxTable(headerCells, bodyRows, colWidths) {
  const result = [];
  const pad = 1; // spaces around cell content

  // Build horizontal rules
  const topLine    = '┌' + colWidths.map(w => '─'.repeat(w + pad * 2)).join('┬') + '┐';
  const midLine    = '├' + colWidths.map(w => '─'.repeat(w + pad * 2)).join('┼') + '┤';
  const bottomLine = '└' + colWidths.map(w => '─'.repeat(w + pad * 2)).join('┴') + '┘';

  const renderRow = (cells, styleFn) => {
    const parts = cells.map((cell, i) => {
      const padded = (cell || '').padEnd(colWidths[i]);
      return ' ' + styleFn(padded) + ' ';
    });
    return ansi.dim('│') + parts.join(ansi.dim('│')) + ansi.dim('│');
  };

  result.push(ansi.dim(topLine));
  result.push(renderRow(headerCells, s => ansi.bold(ansi.fg.brightCyan(s))));
  result.push(ansi.dim(midLine));
  for (const row of bodyRows) {
    result.push(renderRow(row, s => ansi.fg.white(s)));
  }
  result.push(ansi.dim(bottomLine));

  return result;
}

/**
 * Process text that may contain markdown tables mixed with regular prose.
 * Detects table regions (consecutive lines starting with |), formats them
 * as box-drawing tables, and word-wraps everything else.
 * Returns an array of styled/plain lines.
 */
function formatContent(text, maxWidth) {
  const rawLines = text.split(/\r?\n/);
  const output = [];
  let i = 0;

  while (i < rawLines.length) {
    const line = rawLines[i];

    // Detect start of a table: line starts with |
    if (line.trim().startsWith('|')) {
      // Collect all consecutive table lines
      const tableLines = [];
      while (i < rawLines.length && rawLines[i].trim().startsWith('|')) {
        tableLines.push(rawLines[i]);
        i++;
      }

      // Need at least a header + separator + 1 body row to be a real table
      // Find the separator row
      let sepIdx = -1;
      for (let t = 0; t < tableLines.length; t++) {
        if (isTableSeparator(tableLines[t])) { sepIdx = t; break; }
      }

      if (sepIdx >= 1 && tableLines.length > sepIdx + 1) {
        // Parse header (rows before separator, typically just one)
        const headerCells = parseTableRow(tableLines[sepIdx - 1]);
        const bodyRows = [];
        for (let t = sepIdx + 1; t < tableLines.length; t++) {
          if (isTableSeparator(tableLines[t])) continue; // skip extra separators
          bodyRows.push(parseTableRow(tableLines[t]));
        }

        // Compute column widths
        const colCount = Math.max(headerCells.length, ...bodyRows.map(r => r.length));
        const colWidths = [];
        for (let c = 0; c < colCount; c++) {
          let maxW = (headerCells[c] || '').length;
          for (const row of bodyRows) {
            maxW = Math.max(maxW, (row[c] || '').length);
          }
          colWidths.push(maxW);
        }

        // Any lines before the header in the table block (e.g. a preceding | line)
        for (let t = 0; t < sepIdx - 1; t++) {
          output.push(...wordWrap(tableLines[t], maxWidth));
        }

        // Render the box table
        output.push(...renderBoxTable(headerCells, bodyRows, colWidths));
      } else {
        // Not a real table, just lines starting with |, pass through
        for (const tl of tableLines) {
          output.push(...wordWrap(tl, maxWidth));
        }
      }
    } else {
      // Regular line — word wrap
      output.push(...wordWrap(line, maxWidth));
      i++;
    }
  }

  return output;
}

/* ================================================================
   JSONL parser — returns array of events, sorted by timestamp
   ================================================================ */

function parseJSONL(text) {
  const events = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed));
    } catch (e) {
      console.warn('Skipping invalid JSONL line:', e.message);
    }
  }
  events.sort((a, b) => {
    if (a.timestamp && b.timestamp) return new Date(a.timestamp) - new Date(b.timestamp);
    return 0;
  });
  return events;
}

/* ================================================================
   Tool call ID → tool name correlation map.
   Populated during event load so that tool.execution_complete
   events can look up which tool they belong to.
   ================================================================ */
let _toolCallIdMap = {}; // toolCallId → toolName

/* ================================================================
   Renderable event filter
   ================================================================ */

const RENDERABLE_TYPES = new Set([
  'session.start', 'session.resume', 'session.info', 'session.error',
  'session.model_change', 'user.message', 'assistant.message',
  'subagent.started', 'subagent.completed',
  'session.compaction_start', 'session.compaction_complete',
  'tool.user_requested', 'tool.execution_start', 'tool.execution_complete',
]);

function isRenderable(ev) {
  return RENDERABLE_TYPES.has(ev.type);
}

/**
 * Check if an event is a sub-agent child event (tool call or assistant
 * message running inside a background agent).
 */
function isSubagentChild(ev) {
  return !!(ev.data && ev.data.parentToolCallId);
}

/**
 * Produce a compact status line for a sub-agent child event, showing
 * what the agent is currently doing.  Returns null for events that
 * should not update the status (e.g. tool completions — we wait for
 * the next start or assistant message).
 */
function subagentStatusLine(ev, agentName) {
  const d = ev.data;
  const prefix = ansi.bold(ansi.fg.magenta(`  🤖  ${agentName}`));
  const spinner = ansi.dim(ansi.fg.magenta(' ⟳ '));

  if (ev.type === 'tool.execution_start') {
    const toolName = d.toolName || 'tool';
    const argStr = summariseArgs(d.arguments);
    const detail = argStr ? ` — ${truncate(argStr, 60)}` : '';
    return prefix + spinner + ansi.fg.yellow(toolName) + ansi.dim(ansi.fg.yellow(detail));
  }

  if (ev.type === 'assistant.message') {
    const msg = truncate(d.content || '', 70);
    if (msg) return prefix + spinner + ansi.dim(ansi.fg.white(msg));
    return null; // empty assistant message, don't update status
  }

  // tool.execution_complete — don't update the status line
  return null;
}

/* ================================================================
   Playback Engine — with snapshots, filtering, batched rendering
   ================================================================ */

const SNAPSHOT_INTERVAL = 200; // take a snapshot every N renderable events

class PlaybackEngine {
  constructor(terminal) {
    this.terminal = terminal;
    this.events = [];
    this.renderableEvents = [];
    this.currentIndex = -1;
    this.playing = false;
    this.speed = 1;
    this.timer = null;
    this.onUpdate = null;

    // Filters: which categories are visible
    this.filters = { tools: true, reasoning: true, system: true };

    // Snapshot cache for fast seeking: index -> rendered output buffer
    this._snapshots = new Map();
    // Pre-rendered output cache per event index
    this._renderCache = [];
    // Index of user.message events for turn navigation
    this._userMessageIndices = [];

    // Sub-agent collapsing: parentToolCallId → { agentName, indices[] }
    this._subagentGroups = {};
    // Set of renderable-event indices that are sub-agent children
    this._subagentChildIndices = new Set();
    // Tracks the last rendered status line per agent group during live playback
    this._subagentLastStatus = {};
    // Flag for newline management during live playback
    this._lastWasSubagentChild = false;
  }

  load(events) {
    this.stop();
    this.events = events;
    this.renderableEvents = events.filter(isRenderable);
    this.currentIndex = -1;
    // Build toolCallId → toolName correlation map
    _toolCallIdMap = {};
    for (const ev of events) {
      if (ev.type === 'tool.execution_start' && ev.data.toolCallId) {
        _toolCallIdMap[ev.data.toolCallId] = ev.data.toolName;
      }
    }
    this._buildSubagentGroups();
    this._buildCaches();
    this.terminal.clear();
    this.terminal.reset();
    this._notify();
  }

  get total() { return this.renderableEvents.length; }
  get position() { return this.currentIndex + 1; }

  /* ── Filter management ──────────────────────────────────── */

  setFilter(category, enabled) {
    if (this.filters[category] === enabled) return;
    this.filters[category] = enabled;
    this._invalidateRenderCache();
    if (this.currentIndex >= 0) {
      this._replayUpTo(this.currentIndex);
    }
    this._notify();
  }

  toggleFilter(category) {
    this.setFilter(category, !this.filters[category]);
  }

  /* ── Playback controls ──────────────────────────────────── */

  play() {
    if (this.renderableEvents.length === 0) return;
    this.playing = true;
    this._notify();
    this._scheduleNext();
  }

  pause() {
    this.playing = false;
    clearTimeout(this.timer);
    this.timer = null;
    this._notify();
  }

  togglePlay() {
    if (this.playing) this.pause();
    else this.play();
  }

  stop() {
    this.pause();
    this.currentIndex = -1;
    this._subagentLastStatus = {};
    this._lastWasSubagentChild = false;
    this.terminal.clear();
    this.terminal.reset();
    this._notify();
  }

  next() {
    if (this.currentIndex >= this.renderableEvents.length - 1) {
      this.pause();
      return;
    }
    this.currentIndex++;
    this._renderSingleEvent(this.currentIndex);
    this._notify();
    if (this.playing) this._scheduleNext();
  }

  prev() {
    if (this.currentIndex <= 0) return;
    this.currentIndex--;
    this._replayUpTo(this.currentIndex);
    this._notify();
  }

  jumpTo(index) {
    if (index < 0 || index >= this.renderableEvents.length) return;
    const wasPlaying = this.playing;
    if (wasPlaying) this.pause();
    this.currentIndex = index;
    this._replayUpTo(index);
    this._notify();
    if (wasPlaying) this.play();
  }

  nextUserMessage() {
    const next = this._userMessageIndices.find(i => i > this.currentIndex);
    if (next !== undefined) this.jumpTo(next);
  }

  prevUserMessage() {
    // Find the last user message index before currentIndex
    let target = undefined;
    for (const i of this._userMessageIndices) {
      if (i >= this.currentIndex) break;
      target = i;
    }
    if (target !== undefined) this.jumpTo(target);
  }

  setSpeed(s) {
    this.speed = s;
    // Reschedule pending timer with new speed
    if (this.playing && this.timer !== null) {
      clearTimeout(this.timer);
      this._scheduleNext();
    }
  }

  /* ── Internal: caching ──────────────────────────────────── */

  /**
   * Build sub-agent group data.  For each parentToolCallId, we find:
   * - the agent name (from the matching subagent.started event)
   * - all renderable-event indices that are children of that agent
   */
  _buildSubagentGroups() {
    this._subagentGroups = {};
    this._subagentChildIndices = new Set();
    this._subagentLastStatus = {};

    // Map toolCallId → agent display name from subagent.started events
    const agentNames = {};
    for (const ev of this.events) {
      if (ev.type === 'subagent.started' && ev.data.toolCallId) {
        agentNames[ev.data.toolCallId] = ev.data.agentDisplayName || ev.data.agentName || 'agent';
      }
      // Also resolve from 'task' tool calls (which spawn sub-agents)
      if (ev.type === 'tool.execution_start' && ev.data.toolName === 'task' && ev.data.toolCallId) {
        const args = ev.data.arguments || {};
        agentNames[ev.data.toolCallId] = args.description || args.agent_type || 'task agent';
      }
    }

    for (let i = 0; i < this.renderableEvents.length; i++) {
      const ev = this.renderableEvents[i];
      if (isSubagentChild(ev)) {
        const pid = ev.data.parentToolCallId;
        if (!this._subagentGroups[pid]) {
          this._subagentGroups[pid] = {
            agentName: agentNames[pid] || 'agent',
            indices: [],
          };
        }
        this._subagentGroups[pid].indices.push(i);
        this._subagentChildIndices.add(i);
      }
    }
  }

  _buildCaches() {
    this._snapshots.clear();
    this._renderCache = new Array(this.renderableEvents.length);
    this._userMessageIndices = [];

    for (let i = 0; i < this.renderableEvents.length; i++) {
      const ev = this.renderableEvents[i];
      if (ev.type === 'user.message') {
        this._userMessageIndices.push(i);
      }
    }
  }

  _invalidateRenderCache() {
    this._renderCache = new Array(this.renderableEvents.length);
    this._snapshots.clear();
  }

  _getRenderedOutput(index) {
    if (this._renderCache[index] !== undefined) return this._renderCache[index];
    const ev = this.renderableEvents[index];
    if (!ev) { this._renderCache[index] = null; return null; }

    // Check category filter — but exempt agent-related tool calls
    const category = EVENT_CATEGORIES[ev.type];
    if (category && !this.filters[category]) {
      // Agent invocations (task, read_agent) should always render
      const isAgentCall = ev.type === 'tool.execution_start' &&
        (ev.data.toolName === 'task' || ev.data.toolName === 'read_agent');
      const isAgentResult = ev.type === 'tool.execution_complete' &&
        (_toolCallIdMap[ev.data.toolCallId] === 'task' || _toolCallIdMap[ev.data.toolCallId] === 'read_agent');
      if (!isAgentCall && !isAgentResult) {
        this._renderCache[index] = null;
        return null;
      }
    }

    // Sub-agent child events: produce a compact status line instead of full rendering
    if (this._subagentChildIndices.has(index)) {
      const ev2 = this.renderableEvents[index];
      const pid = ev2.data.parentToolCallId;
      const group = this._subagentGroups[pid];
      if (group) {
        const status = subagentStatusLine(ev2, group.agentName);
        // null means "no visual update for this event" (e.g. tool completion)
        this._renderCache[index] = status;
        return status;
      }
    }

    const renderer = STYLE_MAP[ev.type];
    if (!renderer) { this._renderCache[index] = null; return null; }

    const output = renderer(ev, this.filters);
    this._renderCache[index] = output;
    return output;
  }

  /* ── Internal: rendering ────────────────────────────────── */

  _renderSingleEvent(index) {
    const ev = this.renderableEvents[index];

    // Sub-agent child: overwrite previous status line
    if (ev && this._subagentChildIndices.has(index)) {
      const pid = ev.data.parentToolCallId;
      const output = this._getRenderedOutput(index);
      if (output === null || output === undefined) return;

      if (this._subagentLastStatus[pid]) {
        // Overwrite: clear line, carriage return, write new status
        this.terminal.write(`\x1b[2K\r${output}`);
      } else {
        // First status line for this agent — write without newline so we can overwrite
        this.terminal.write(`\r\n${output}`);
      }
      this._subagentLastStatus[pid] = output;
      this._lastWasSubagentChild = true;
      return;
    }

    // If previous render was a sub-agent status (no trailing newline), close it
    if (this._lastWasSubagentChild) {
      this.terminal.writeln('');
      this._lastWasSubagentChild = false;
    }

    const output = this._getRenderedOutput(index);
    if (output === null || output === undefined) return;
    for (const line of output.split('\r\n')) {
      this.terminal.writeln(line);
    }
  }

  _replayUpTo(index) {
    // Find nearest snapshot before index
    let startFrom = 0;
    let snapshotBuffer = null;

    for (const [snapIdx, buf] of this._snapshots) {
      if (snapIdx <= index && snapIdx >= startFrom) {
        startFrom = snapIdx + 1;
        snapshotBuffer = buf;
      }
    }

    this.terminal.clear();
    this.terminal.reset();
    // Reset sub-agent tracking for replay
    this._subagentLastStatus = {};
    this._lastWasSubagentChild = false;

    // Pre-compute: for each sub-agent group, find the last child index
    // that is <= `index` and has a non-null status line.  Only that one
    // gets rendered in the replay buffer (collapsed view).
    const lastChildForGroup = {};
    for (const [pid, group] of Object.entries(this._subagentGroups)) {
      let last = -1;
      for (const ci of group.indices) {
        if (ci > index) break;
        if (ci < startFrom) continue;
        const ev = this.renderableEvents[ci];
        const status = subagentStatusLine(ev, group.agentName);
        if (status !== null) last = ci;
      }
      if (last >= 0) lastChildForGroup[pid] = last;
    }

    // Build buffer for all events from startFrom to index
    const parts = [];
    if (snapshotBuffer) {
      parts.push(snapshotBuffer);
    }

    for (let i = startFrom; i <= index; i++) {
      const ev = this.renderableEvents[i];

      // Sub-agent child: only render the last status line per group
      if (ev && this._subagentChildIndices.has(i)) {
        const pid = ev.data.parentToolCallId;
        if (lastChildForGroup[pid] === i) {
          const output = this._getRenderedOutput(i);
          if (output) {
            parts.push('\r\n');
            parts.push(output);
          }
        }
        // Skip all other child events for this group
        continue;
      }

      const output = this._getRenderedOutput(i);
      if (output === null || output === undefined) continue;
      parts.push('\r\n');
      parts.push(output);

      // Save snapshot at interval boundaries
      if (i > 0 && i % SNAPSHOT_INTERVAL === 0 && !this._snapshots.has(i)) {
        if (this._snapshots.size > 50) {
          const firstKey = this._snapshots.keys().next().value;
          this._snapshots.delete(firstKey);
        }
        this._snapshots.set(i, parts.join(''));
      }
    }

    // Write entire buffer at once for performance
    const fullBuffer = parts.join('');
    if (fullBuffer) {
      this.terminal.write(fullBuffer, () => {
        // Delay scroll slightly to ensure xterm has finished layout
        setTimeout(() => this.terminal.scrollToBottom(), 50);
      });
    }

    // Save snapshot at current position if appropriate
    if (index > 0 && index % SNAPSHOT_INTERVAL === 0 && !this._snapshots.has(index)) {
      if (this._snapshots.size > 50) {
        const firstKey = this._snapshots.keys().next().value;
        this._snapshots.delete(firstKey);
      }
      this._snapshots.set(index, fullBuffer);
    }
  }

  /* ── Internal: scheduling ───────────────────────────────── */

  _scheduleNext() {
    clearTimeout(this.timer);
    if (!this.playing) return;
    if (this.currentIndex >= this.renderableEvents.length - 1) {
      this.pause();
      return;
    }

    const delay = this._getDelay();

    // At high speeds (>10x), batch multiple events per tick
    if (this.speed >= 10) {
      const batchSize = Math.min(Math.floor(this.speed / 5), 20);
      this.timer = setTimeout(() => {
        if (!this.playing) return;
        for (let i = 0; i < batchSize; i++) {
          if (!this.playing) return;
          if (this.currentIndex >= this.renderableEvents.length - 1) {
            this.pause();
            return;
          }
          this.currentIndex++;
          this._renderSingleEvent(this.currentIndex);
        }
        this._notify();
        this._scheduleNext();
      }, delay);
    } else {
      this.timer = setTimeout(() => this.next(), delay);
    }
  }

  _getDelay() {
    const next = this.renderableEvents[this.currentIndex + 1];
    if (!next) return 300;
    const base = BASE_DELAYS[next.type] || 300;
    return Math.max(16, base / this.speed);
  }

  _notify() {
    if (this.onUpdate) this.onUpdate();
  }
}

/* ================================================================
   Search scope — maps event types to search scope categories
   ================================================================ */
const SEARCH_SCOPES = {
  'user.message': 'user',
  'assistant.message': 'assistant',
  'tool.execution_start': 'tools',
  'tool.execution_complete': 'tools',
  'tool.user_requested': 'tools',
  'subagent.started': 'tools',
  'subagent.completed': 'tools',
  'session.start': 'assistant',
  'session.resume': 'assistant',
  'session.info': 'assistant',
  'session.error': 'assistant',
  'session.model_change': 'assistant',
  'session.compaction_start': 'assistant',
  'session.compaction_complete': 'assistant',
};

/* ================================================================
   Event-level search — searches event text with scope filtering
   ================================================================ */

class EventSearcher {
  constructor(engine) {
    this.engine = engine;
    this.query = '';
    this.matches = [];  // indices into renderableEvents
    this.matchIndex = -1;
    this.scopes = { user: true, assistant: true, tools: true };
  }

  setScopes(scopes) {
    this.scopes = { ...this.scopes, ...scopes };
  }

  search(query) {
    this.query = query.toLowerCase();
    this.matches = [];
    this.matchIndex = -1;

    if (!this.query) return;

    const events = this.engine.renderableEvents;
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];

      // Skip sub-agent child events (they're collapsed in the UI)
      if (this.engine._subagentChildIndices.has(i)) continue;

      // Skip if category is filtered out (display filter)
      const category = EVENT_CATEGORIES[ev.type];
      if (category && !this.engine.filters[category]) continue;

      // Skip if search scope is unchecked
      const scope = SEARCH_SCOPES[ev.type] || 'assistant';
      if (!this.scopes[scope]) continue;

      const text = this._eventToSearchText(ev);
      if (text.toLowerCase().includes(this.query)) {
        this.matches.push(i);
      }
    }
  }

  nextMatch() {
    if (this.matches.length === 0) return -1;
    this.matchIndex = (this.matchIndex + 1) % this.matches.length;
    return this.matches[this.matchIndex];
  }

  prevMatch() {
    if (this.matches.length === 0) return -1;
    this.matchIndex = (this.matchIndex - 1 + this.matches.length) % this.matches.length;
    return this.matches[this.matchIndex];
  }

  get count() { return this.matches.length; }
  get currentMatchIndex() { return this.matchIndex; }

  _eventToSearchText(ev) {
    const d = ev.data || {};
    const parts = [ev.type];
    if (d.content) parts.push(d.content);
    if (d.reasoningText) parts.push(d.reasoningText);
    if (d.message) parts.push(d.message);
    if (d.toolName) parts.push(d.toolName);
    if (d.agentName) parts.push(d.agentName);
    if (d.agentDisplayName) parts.push(d.agentDisplayName);
    if (d.result?.content) parts.push(d.result.content);
    if (d.arguments) {
      for (const v of Object.values(d.arguments)) {
        if (typeof v === 'string') parts.push(v);
      }
    }
    return parts.join(' ');
  }
}

/* ================================================================
   DOM wiring & initialisation
   ================================================================ */

document.addEventListener('DOMContentLoaded', () => {
  /* ── Create terminal ──────────────────────────────────────── */
  const termContainer = document.getElementById('terminal-container');
  const term = new window.Terminal({
    theme: {
      background: '#1a1b26',
      foreground: '#c0caf5',
      cursor: '#c0caf5',
      cursorAccent: '#1a1b26',
      selectionBackground: '#33467c',
      black: '#15161e',
      red: '#f7768e',
      green: '#9ece6a',
      yellow: '#e0af68',
      blue: '#7aa2f7',
      magenta: '#bb9af7',
      cyan: '#7dcfff',
      white: '#a9b1d6',
      brightBlack: '#414868',
      brightRed: '#f7768e',
      brightGreen: '#9ece6a',
      brightYellow: '#e0af68',
      brightBlue: '#7aa2f7',
      brightMagenta: '#bb9af7',
      brightCyan: '#7dcfff',
      brightWhite: '#c0caf5',
    },
    fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Consolas', monospace",
    fontSize: 14,
    lineHeight: 1.3,
    cursorBlink: false,
    cursorStyle: 'underline',
    scrollback: 100000,
    convertEol: true,
  });

  const fitAddon = new window.FitAddon.FitAddon();
  term.loadAddon(fitAddon);

  try {
    const webLinksAddon = new window.WebLinksAddon.WebLinksAddon();
    term.loadAddon(webLinksAddon);
  } catch { /* optional */ }

  let searchAddon = null;
  try {
    searchAddon = new window.SearchAddon.SearchAddon();
    term.loadAddon(searchAddon);
  } catch { /* optional */ }

  term.open(termContainer);
  fitAddon.fit();

  window.addEventListener('resize', () => fitAddon.fit());
  new ResizeObserver(() => fitAddon.fit()).observe(termContainer);

  // Welcome message with ASCII art — centered in terminal
  const logoLines = [
    '██████╗  ██████╗ ██████╗ ██╗██╗      ██████╗ ████████╗',
    '██╔════╝ ██╔═══██╗██╔══██╗██║██║     ██╔═══██╗╚══██╔══╝',
    '██║      ██║   ██║██████╔╝██║██║     ██║   ██║   ██║   ',
    '██║      ██║   ██║██╔═══╝ ██║██║     ██║   ██║   ██║   ',
    '╚██████╗ ╚██████╔╝██║     ██║███████╗╚██████╔╝   ██║   ',
    ' ╚═════╝  ╚═════╝ ╚═╝     ╚═╝╚══════╝ ╚═════╝    ╚═╝   ',
  ];
  const tagline = 'S E S S I O N    E X P L O R E R';
  const infoLines = [
    'Load a .jsonl session file to begin playback.',
    'Drag & drop or click "Load Session" above.',
    '',
    '─── How to get your session file ───',
    '',
  ];
  const stepLines = [
    { num: '1. ', text: 'Run ', hl: '/session', after: ' in your Copilot CLI session' },
    { num: '2. ', text: 'Copy the path to the ', hl: 'events.jsonl', after: ' file shown in the output' },
    { num: '3. ', text: 'Load it here via drag & drop or the file picker', hl: '', after: '' },
  ];
  const footer = 'Press ? for keyboard shortcuts.';

  // Total content height: logo(6) + tagline(1) + blank(1) + info(5) + steps(3) + blank(1) + footer(1) = 18
  const contentHeight = logoLines.length + 1 + 1 + infoLines.length + stepLines.length + 1 + 1;
  const topPad = Math.max(0, Math.floor((term.rows - contentHeight) / 2));

  // Centering helper: pad a string to be centered in term.cols
  const center = (s, len) => {
    const visualLen = len !== undefined ? len : s.length;
    const pad = Math.max(0, Math.floor((term.cols - visualLen) / 2));
    return ' '.repeat(pad) + s;
  };

  // Vertical padding
  for (let i = 0; i < topPad; i++) term.writeln('');

  // Logo — widest line is ~57 visible chars (box-drawing chars are single-width)
  for (const line of logoLines) {
    term.writeln(ansi.bold(ansi.fg.brightBlue(center(line, line.length))));
  }

  // Tagline
  term.writeln(ansi.bold(ansi.fg.cyan(center(tagline))));
  term.writeln('');

  // Info lines
  for (const line of infoLines) {
    term.writeln(ansi.dim(ansi.fg.gray(center(line))));
  }

  // Steps
  for (const s of stepLines) {
    const full = s.num + s.text + s.hl + s.after;
    const pad = ' '.repeat(Math.max(0, Math.floor((term.cols - full.length) / 2)));
    term.writeln(
      pad +
      ansi.fg.cyan(s.num) +
      ansi.fg.white(s.text) +
      (s.hl ? ansi.bold(ansi.fg.brightYellow(s.hl)) : '') +
      ansi.fg.white(s.after)
    );
  }

  term.writeln('');
  term.writeln(ansi.dim(ansi.fg.gray(center(footer))));

  /* ── Playback engine ──────────────────────────────────────── */
  const engine = new PlaybackEngine(term);
  const searcher = new EventSearcher(engine);

  /* ── DOM refs ─────────────────────────────────────────────── */
  const fileInput       = document.getElementById('file-input');
  const sessionInfo     = document.getElementById('session-info');
  const titlebarTitle   = document.getElementById('titlebar-title');
  const btnPrevTurn     = document.getElementById('btn-prev-turn');
  const btnPrev         = document.getElementById('btn-prev');
  const btnPlay         = document.getElementById('btn-play');
  const btnNext         = document.getElementById('btn-next');
  const btnNextTurn     = document.getElementById('btn-next-turn');
  const btnRestart      = document.getElementById('btn-restart');
  const btnHelp         = document.getElementById('btn-help');
  const speedSlider     = document.getElementById('speed-slider');
  const speedDisplay    = document.getElementById('speed-display');
  const progress        = document.getElementById('progress');
  const dropOverlay     = document.getElementById('drop-overlay');
  const helpOverlay     = document.getElementById('help-overlay');
  const scrubber        = document.getElementById('scrubber');
  const scrubberMarkers = document.getElementById('scrubber-markers');
  const filterTools     = document.getElementById('filter-tools');
  const filterReasoning = document.getElementById('filter-reasoning');
  const filterSystem    = document.getElementById('filter-system');
  const searchBar       = document.getElementById('search-bar');
  const searchInput     = document.getElementById('search-input');
  const searchCount     = document.getElementById('search-count');
  const searchPrev      = document.getElementById('search-prev');
  const searchNext      = document.getElementById('search-next');
  const searchClose     = document.getElementById('search-close');
  const scopeUser       = document.getElementById('scope-user');
  const scopeAssistant  = document.getElementById('scope-assistant');
  const scopeTools      = document.getElementById('scope-tools');

  /* ── UI update callback ───────────────────────────────────── */
  let scrubberUpdating = false;

  engine.onUpdate = () => {
    progress.textContent = `${engine.position} / ${engine.total}`;
    btnPlay.textContent = engine.playing ? '⏸' : '▶';
    btnPlay.classList.toggle('playing', engine.playing);
    btnPlay.disabled = engine.total === 0;
    btnNext.disabled = engine.total === 0 || engine.position >= engine.total;
    btnPrev.disabled = engine.position <= 1;
    btnNextTurn.disabled = engine.total === 0;
    btnPrevTurn.disabled = engine.total === 0;
    btnRestart.disabled = engine.total === 0;

    // Sync scrubber
    if (!scrubberUpdating) {
      scrubber.max = Math.max(0, engine.total - 1);
      scrubber.value = Math.max(0, engine.currentIndex);
      scrubber.disabled = engine.total === 0;
    }
  };

  /* ── Scrubber timeline ────────────────────────────────────── */
  let scrubberDebounce;
  function buildScrubberMarkers() {
    scrubberMarkers.innerHTML = '';
    if (engine.total === 0) return;
    const total = engine.total;

    for (let i = 0; i < engine.renderableEvents.length; i++) {
      const ev = engine.renderableEvents[i];
      let cls = null;
      if (ev.type === 'user.message') cls = 'user';
      else if (ev.type === 'session.error') cls = 'error';
      if (!cls) continue;

      const mark = document.createElement('div');
      mark.className = `scrubber-mark ${cls}`;
      mark.style.left = `${(i / total) * 100}%`;
      mark.title = cls === 'user'
        ? `User message #${engine._userMessageIndices.indexOf(i) + 1}`
        : 'Error';
      scrubberMarkers.appendChild(mark);
    }
  }

  scrubber.addEventListener('input', () => {
    scrubberUpdating = true;
    const idx = parseInt(scrubber.value, 10);
    if (engine.playing) engine.pause();
    clearTimeout(scrubberDebounce);
    scrubberDebounce = setTimeout(() => {
      engine.jumpTo(idx);
      scrubberUpdating = false;
    }, 50);
  });

  /* ── Filter buttons ───────────────────────────────────────── */
  function syncFilterButtons() {
    filterTools.classList.toggle('active', engine.filters.tools);
    filterReasoning.classList.toggle('active', engine.filters.reasoning);
    filterSystem.classList.toggle('active', engine.filters.system);
  }

  filterTools.addEventListener('click', () => { engine.toggleFilter('tools'); syncFilterButtons(); });
  filterReasoning.addEventListener('click', () => { engine.toggleFilter('reasoning'); syncFilterButtons(); });
  filterSystem.addEventListener('click', () => { engine.toggleFilter('system'); syncFilterButtons(); });

  /* ── Search ───────────────────────────────────────────────── */
  function openSearch() {
    searchBar.classList.remove('hidden');
    searchInput.focus();
    searchInput.select();
  }

  function closeSearch() {
    searchBar.classList.add('hidden');
    searchCount.textContent = '';
    searcher.search('');
    // Clear xterm search decorations
    if (searchAddon) {
      try { searchAddon.clearDecorations(); } catch { /* v5.5 compat */ }
    }
  }

  function doSearch() {
    const q = searchInput.value.trim();
    searcher.search(q);
    if (searcher.count > 0) {
      searchCount.textContent = `${searcher.count} found`;
    } else if (q) {
      searchCount.textContent = 'No matches';
    } else {
      searchCount.textContent = '';
    }
    // Clear stale xterm highlights — don't call findNext here because
    // it searches the raw buffer and ignores our scope filters.
    if (searchAddon) {
      try { searchAddon.clearDecorations(); } catch { /* v5.5 compat */ }
    }
  }

  /**
   * After engine.jumpTo() re-renders the terminal up to the matched event,
   * highlight the search term in the terminal buffer.  We search backwards
   * from the end of the buffer so the highlight lands on the matched event
   * (which is always the last rendered content).
   */
  function highlightSearchInTerminal(query) {
    if (!searchAddon || !query) return;
    // xterm.write() is async; give it a tick to flush
    setTimeout(() => {
      try {
        searchAddon.findPrevious(query, { caseSensitive: false });
      } catch { /* addon compat */ }
    }, 60);
  }

  let searchDebounce = null;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(doSearch, 200);
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.code === 'Enter') {
      e.preventDefault();
      const idx = e.shiftKey ? searcher.prevMatch() : searcher.nextMatch();
      if (idx >= 0) {
        engine.jumpTo(idx);
        highlightSearchInTerminal(searchInput.value.trim());
      }
      if (searcher.count > 0) {
        searchCount.textContent = `${searcher.currentMatchIndex + 1} / ${searcher.count}`;
      }
    }
    if (e.code === 'Escape') {
      e.preventDefault();
      closeSearch();
    }
  });

  searchNext.addEventListener('click', () => {
    const idx = searcher.nextMatch();
    if (idx >= 0) {
      engine.jumpTo(idx);
      highlightSearchInTerminal(searchInput.value.trim());
    }
    if (searcher.count > 0) {
      searchCount.textContent = `${searcher.currentMatchIndex + 1} / ${searcher.count}`;
    }
  });

  searchPrev.addEventListener('click', () => {
    const idx = searcher.prevMatch();
    if (idx >= 0) {
      engine.jumpTo(idx);
      highlightSearchInTerminal(searchInput.value.trim());
    }
    if (searcher.count > 0) {
      searchCount.textContent = `${searcher.currentMatchIndex + 1} / ${searcher.count}`;
    }
  });

  searchClose.addEventListener('click', closeSearch);

  /* ── Search scope checkboxes ──────────────────────────────── */
  function updateSearchScopes() {
    searcher.setScopes({
      user: scopeUser.checked,
      assistant: scopeAssistant.checked,
      tools: scopeTools.checked,
    });
    doSearch();
  }

  scopeUser.addEventListener('change', updateSearchScopes);
  scopeAssistant.addEventListener('change', updateSearchScopes);
  scopeTools.addEventListener('change', updateSearchScopes);

  /* ── Help overlay ─────────────────────────────────────────── */
  function toggleHelp() {
    helpOverlay.classList.toggle('hidden');
  }

  btnHelp.addEventListener('click', toggleHelp);
  helpOverlay.addEventListener('click', (e) => {
    if (e.target === helpOverlay) toggleHelp();
  });

  /* ── File loading ─────────────────────────────────────────── */
  function loadFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const events = parseJSONL(e.target.result);
      engine.load(events);
      buildScrubberMarkers();
      // Reset search state
      closeSearch();
      const startEvent = events.find(ev => ev.type === 'session.start');
      if (startEvent) {
        const d = startEvent.data;
        sessionInfo.textContent = `${d.producer || 'agent'} v${d.copilotVersion || '?'} — ${events.length} events`;
        titlebarTitle.textContent = `${d.producer || 'Session'} — ${file.name}`;
      } else {
        sessionInfo.textContent = `${events.length} events`;
        titlebarTitle.textContent = file.name;
      }
      engine.play();
    };
    reader.readAsText(file);
  }

  fileInput.addEventListener('change', (e) => {
    if (e.target.files[0]) loadFile(e.target.files[0]);
  });

  /* ── Drag & drop ──────────────────────────────────────────── */
  let dragCounter = 0;
  document.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    dropOverlay.classList.remove('hidden');
  });
  document.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      dropOverlay.classList.add('hidden');
    }
  });
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    dropOverlay.classList.add('hidden');
    const file = e.dataTransfer?.files[0];
    if (file && file.name.endsWith('.jsonl')) loadFile(file);
  });

  /* ── Button handlers ──────────────────────────────────────── */
  btnPlay.addEventListener('click', () => engine.togglePlay());
  btnNext.addEventListener('click', () => {
    if (engine.playing) engine.pause();
    engine.next();
  });
  btnPrev.addEventListener('click', () => {
    if (engine.playing) engine.pause();
    engine.prev();
  });
  btnNextTurn.addEventListener('click', () => {
    if (engine.playing) engine.pause();
    engine.nextUserMessage();
  });
  btnPrevTurn.addEventListener('click', () => {
    if (engine.playing) engine.pause();
    engine.prevUserMessage();
  });
  btnRestart.addEventListener('click', () => {
    engine.stop();
  });

  speedSlider.addEventListener('input', () => {
    const val = parseInt(speedSlider.value, 10);
    engine.setSpeed(val);
    speedDisplay.textContent = `${val}x`;
  });

  /* ── Keyboard shortcuts ───────────────────────────────────── */
  document.addEventListener('keydown', (e) => {
    // Don't capture when typing in search input
    if (e.target === searchInput) return;
    // Don't capture when typing in other text inputs
    if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return;

    // Close overlays on Escape
    if (e.code === 'Escape') {
      if (!helpOverlay.classList.contains('hidden')) {
        toggleHelp();
        return;
      }
      if (!searchBar.classList.contains('hidden')) {
        closeSearch();
        return;
      }
    }

    switch (e.code) {
      case 'Space':
        e.preventDefault();
        engine.togglePlay();
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (engine.playing) engine.pause();
        if (e.shiftKey) engine.nextUserMessage();
        else engine.next();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (engine.playing) engine.pause();
        if (e.shiftKey) engine.prevUserMessage();
        else engine.prev();
        break;
      case 'KeyR':
        if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          engine.stop();
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        speedSlider.value = Math.min(50, parseInt(speedSlider.value) + 1);
        speedSlider.dispatchEvent(new Event('input'));
        break;
      case 'ArrowDown':
        e.preventDefault();
        speedSlider.value = Math.max(1, parseInt(speedSlider.value) - 1);
        speedSlider.dispatchEvent(new Event('input'));
        break;
      case 'KeyT':
        if (!e.ctrlKey && !e.metaKey) {
          engine.toggleFilter('tools');
          syncFilterButtons();
        }
        break;
      case 'KeyY':
        if (!e.ctrlKey && !e.metaKey) {
          engine.toggleFilter('reasoning');
          syncFilterButtons();
        }
        break;
      case 'KeyI':
        if (!e.ctrlKey && !e.metaKey) {
          engine.toggleFilter('system');
          syncFilterButtons();
        }
        break;
      case 'KeyF':
        if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          openSearch();
        }
        break;
      case 'Slash':
        if (e.shiftKey) { // ? key
          e.preventDefault();
          toggleHelp();
        }
        break;
    }
  });

  /* ── Auto-load events.jsonl if co-located ─────────────────── */
  (async () => {
    try {
      const resp = await fetch('events.jsonl');
      if (resp.ok) {
        const text = await resp.text();
        const events = parseJSONL(text);
        if (events.length > 0) {
          engine.load(events);
          buildScrubberMarkers();
          const startEvent = events.find(ev => ev.type === 'session.start');
          if (startEvent) {
            const d = startEvent.data;
            sessionInfo.textContent = `${d.producer || 'agent'} v${d.copilotVersion || '?'} — ${events.length} events`;
            titlebarTitle.textContent = `${d.producer || 'Session'} — events.jsonl`;
          } else {
            sessionInfo.textContent = `${events.length} events`;
            titlebarTitle.textContent = 'events.jsonl';
          }
          term.writeln(ansi.dim(ansi.fg.gray('  Auto-loaded events.jsonl — press Space or ▶ to play.')));
          term.writeln('');
        }
      }
    } catch { /* no auto-load */ }
  })();
});
