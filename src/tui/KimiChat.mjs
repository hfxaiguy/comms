import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Box, Text, useInput, useWindowSize } from 'ink';
import { callKimi } from '../kimi.mjs';
import { runCode, loadProfilesForGroup, getGroups, saveAutomation } from '../automations.mjs';

const h = React.createElement;

const MAX_ITERS = 5;

// ── Line builder ───────────────────────────────────────────────────────────────

function wrapText(text, width) {
  const words = String(text).split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    if (!cur) { cur = w; continue; }
    if ((cur + ' ' + w).length <= width) { cur += ' ' + w; }
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

function messageToLines(msg, width) {
  const inner = width - 4;
  const lines = [];

  if (msg.role === 'user') {
    for (const l of wrapText(msg.text, inner)) {
      lines.push({ kind: 'user', text: l });
    }
    lines.push({ kind: 'gap' });
    return lines;
  }

  // kimi turn
  if (msg.reasoning) {
    const short = msg.reasoning.length > 120 ? msg.reasoning.slice(0, 120) + '…' : msg.reasoning;
    lines.push({ kind: 'reasoning', text: short });
  }

  if (msg.code) {
    lines.push({ kind: 'code-top' });
    for (const l of msg.code.split('\n').slice(0, 30)) {
      lines.push({ kind: 'code-line', text: l.slice(0, inner - 4) });
    }
    if (msg.code.split('\n').length > 30) lines.push({ kind: 'code-line', text: '  ...' });
    lines.push({ kind: 'code-bot' });
  }

  if (msg.error) {
    lines.push({ kind: 'error', text: '✗ ' + msg.error.slice(0, inner) });
  } else if (msg.output != null) {
    const out = JSON.stringify(msg.output);
    for (const l of wrapText(out.slice(0, 500), inner)) {
      lines.push({ kind: 'output', text: l });
    }
  }

  if (msg.result_text) {
    for (const l of wrapText(msg.result_text, inner)) {
      lines.push({ kind: 'result', text: l });
    }
  }

  lines.push({ kind: 'gap' });
  return lines;
}

function renderLine(line, i) {
  switch (line.kind) {
    case 'user':
      return h(Box, { key: i, paddingX: 2 },
        h(Text, { color: 'green' }, '> '),
        h(Text, {}, line.text),
      );
    case 'reasoning':
      return h(Box, { key: i, paddingX: 2 },
        h(Text, { dimColor: true }, line.text),
      );
    case 'code-top':
      return h(Box, { key: i, paddingX: 2 },
        h(Text, { color: 'yellow' }, '┌─ code'),
      );
    case 'code-bot':
      return h(Box, { key: i, paddingX: 2 },
        h(Text, { color: 'yellow' }, '└────────'),
      );
    case 'code-line':
      return h(Box, { key: i, paddingX: 2 },
        h(Text, { color: 'yellow' }, '│ '),
        h(Text, { color: 'yellow' }, line.text),
      );
    case 'output':
      return h(Box, { key: i, paddingX: 2 },
        h(Text, { color: 'cyan' }, '→ '),
        h(Text, {}, line.text),
      );
    case 'result':
      return h(Box, { key: i, paddingX: 2 },
        h(Text, {}, line.text),
      );
    case 'error':
      return h(Box, { key: i, paddingX: 2 },
        h(Text, { color: 'red' }, line.text),
      );
    case 'gap':
      return h(Box, { key: i }, h(Text, {}, ' '));
    default:
      return h(Box, { key: i }, h(Text, {}, line.text ?? ''));
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function KimiChat({ onBack }) {
  const { columns, rows } = useWindowSize();

  const [phase,       setPhase      ] = useState('picking-group');
  const [groups,      setGroups     ] = useState(() => ['all', ...getGroups()]);
  const [groupCursor, setGroupCursor] = useState(0);
  const [group,       setGroup      ] = useState(null);

  const [messages, setMessages] = useState([]);
  const [input,    setInput   ] = useState('');
  const [scroll,   setScroll  ] = useState(0);
  const [status,   setStatus  ] = useState(null); // running status text

  const [pendingCode, setPendingCode] = useState(null); // code to save if accepted
  const [saveName,    setSaveName   ] = useState('');

  const workingRef  = useRef([]);   // current iteration chain
  const abortRef    = useRef(null);
  const profilesRef = useRef([]);
  const messagesRef = useRef([]);   // always-current snapshot for async loops

  // Pre-compute all lines for scrolling
  const allLines = useMemo(() => {
    const w = columns || 80;
    return messages.flatMap((m, i) => messageToLines(m, w));
  }, [messages, columns]);

  // header(1) + group(1) + status/input(2) + footer(1) + padding(2) = 7
  const viewHeight = Math.max(1, rows - 7);
  const maxScroll  = Math.max(0, allLines.length - viewHeight);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    setScroll(Math.max(0, allLines.length - viewHeight));
  }, [allLines.length]);

  function addMessage(msg) {
    messagesRef.current = [...messagesRef.current, msg];
    setMessages(messagesRef.current);
  }

  // ── Kimi loop ──────────────────────────────────────────────────────────────

  const runKimiLoop = useCallback(async (userInstruction) => {
    const abort = new AbortController();
    abortRef.current = abort;
    workingRef.current = [];

    let instruction = userInstruction;
    let source      = 'user';

    for (let iter = 0; iter < MAX_ITERS; iter++) {
      if (abort.signal.aborted) break;

      const iterationsLeft = MAX_ITERS - iter;
      setStatus(`kimi thinking… (${iter + 1}/${MAX_ITERS})`);

      let response;
      try {
        response = await callKimi(
          messagesRef.current,
          workingRef.current,
          instruction,
          iterationsLeft,
          abort.signal,
        );
      } catch (e) {
        if (abort.signal.aborted) break;
        addMessage({ role: 'kimi', result_text: `Error: ${e.message}`, reasoning: '' });
        break;
      }

      // Run code if present
      let output = null;
      let error  = null;

      if (response.code) {
        setStatus('running code…');
        try {
          output = await runCode(response.code, profilesRef.current);
        } catch (e) {
          error = e.message;
        }
      }

      // Record iteration
      const currentIter = { instruction, source, reasoning: response.reasoning, code: response.code, output, error };
      workingRef.current = [...workingRef.current, currentIter];

      // Add kimi message to chat
      addMessage({
        role:        'kimi',
        reasoning:   response.reasoning,
        code:        response.code,
        output,
        error,
        result_text: response.result_text,
      });

      if (response.done) {
        setPendingCode(response.code ?? null);
        setPhase('reviewing');
        setStatus(null);
        return;
      }

      if (!response.next_prompt) {
        setStatus(null);
        setPhase('idle');
        return;
      }

      instruction = response.next_prompt;
      source      = 'kimi';
    }

    setStatus(null);
    setPhase('reviewing');
  }, []);

  // ── Input handling ────────────────────────────────────────────────────────

  useInput((input_char, key) => {
    // Group picker
    if (phase === 'picking-group') {
      if (key.escape)    { onBack(); return; }
      if (key.upArrow)   { setGroupCursor(c => Math.max(0, c - 1)); return; }
      if (key.downArrow) { setGroupCursor(c => Math.min(groups.length - 1, c + 1)); return; }
      if (key.return) {
        const g = groups[groupCursor];
        setGroup(g);
        profilesRef.current = loadProfilesForGroup(g);
        setPhase('idle');
        return;
      }
      return;
    }

    // Saving automation name
    if (phase === 'saving') {
      if (key.escape)                       { setPhase('idle'); setSaveName(''); return; }
      if (key.return) {
        const name = saveName.trim();
        if (name && pendingCode) {
          saveAutomation(name, {
            name,
            description: '',
            code:        pendingCode,
            group,
            created_at:  new Date().toISOString(),
          });
          addMessage({ role: 'kimi', result_text: `Saved automation "${name}".`, reasoning: '' });
        }
        setPhase('idle');
        setSaveName('');
        setPendingCode(null);
        return;
      }
      if (key.backspace || key.delete)      { setSaveName(n => n.slice(0, -1)); return; }
      if (input_char && !key.ctrl && !key.meta) { setSaveName(n => n + input_char); return; }
      return;
    }

    // Reviewing
    if (phase === 'reviewing') {
      if (input_char === 'a' && pendingCode) { setPhase('saving'); setSaveName(''); return; }
      if (input_char === 'c')               { setPhase('idle'); return; }
      if (input_char === 'd')               { setPhase('idle'); return; }
      return;
    }

    // Running — only escape to abort
    if (phase === 'running') {
      if (key.escape) { abortRef.current?.abort(); setPhase('idle'); setStatus(null); }
      return;
    }

    // Idle — typing input
    if (phase === 'idle') {
      if (key.escape)    { onBack(); return; }
      if (key.upArrow)   { setScroll(s => Math.max(0, s - 1)); return; }
      if (key.downArrow) { setScroll(s => Math.min(maxScroll, s + 1)); return; }
      if (key.return && input.trim()) {
        const text = input.trim();
        setInput('');
        addMessage({ role: 'user', text });
        setPhase('running');
        // runKimiLoop sees the state snapshot from this render — pass text directly
        runKimiLoop(text);
        return;
      }
      if (key.backspace || key.delete)         { setInput(s => s.slice(0, -1)); return; }
      if (input_char && !key.ctrl && !key.meta) { setInput(s => s + input_char); return; }
    }
  });

  // ── Render ────────────────────────────────────────────────────────────────

  if (phase === 'picking-group') {
    return h(Box, { flexDirection: 'column' },
      h(Box, { paddingX: 1 },
        h(Text, { bold: true, color: 'magenta' }, 'kimi  '),
        h(Text, { dimColor: true }, 'pick a group to work with'),
      ),
      h(Box, { height: 1 }),
      ...groups.map((g, i) =>
        h(Box, { key: g, paddingX: 2 },
          h(Text, { inverse: i === groupCursor }, `${i === groupCursor ? '▸' : ' '} ${g}`),
        )
      ),
      h(Box, { paddingX: 1, marginTop: 1 },
        h(Text, { dimColor: true }, '↑↓ navigate  ↵ select  esc back'),
      ),
    );
  }

  const visibleLines = allLines.slice(scroll, scroll + viewHeight);

  return h(Box, { flexDirection: 'column', height: rows },
    // Header
    h(Box, { paddingX: 1 },
      h(Text, { bold: true, color: 'magenta' }, 'kimi  '),
      h(Text, { dimColor: true }, `group: ${group}  ·  ${profilesRef.current.length} profiles`),
    ),

    // Message area
    h(Box, { flexDirection: 'column', flexGrow: 1, overflow: 'hidden' },
      ...visibleLines.map((line, i) => renderLine(line, scroll + i)),
      visibleLines.length === 0
        ? h(Box, { paddingX: 2 }, h(Text, { dimColor: true }, 'ask kimi anything about your contacts…'))
        : null,
    ),

    // Status / input / reviewing
    phase === 'running'
      ? h(Box, { paddingX: 1 },
          h(Text, { color: 'yellow' }, '⏳ '),
          h(Text, { dimColor: true }, status ?? 'running…'),
          h(Text, { dimColor: true }, '  esc abort'),
        )
      : phase === 'reviewing'
        ? h(Box, { paddingX: 1 },
            h(Text, { color: 'green' }, '[done] '),
            pendingCode ? h(Text, {}, 'a save  ') : null,
            h(Text, {}, 'c continue  d discard'),
          )
        : phase === 'saving'
          ? h(Box, { paddingX: 1 },
              h(Text, { dimColor: true }, 'save as: '),
              h(Text, { color: 'yellow' }, saveName + '█'),
            )
          : h(Box, { paddingX: 1 },
              h(Text, { color: 'green' }, '> '),
              h(Text, {}, input),
              h(Text, { color: 'green' }, '█'),
            ),

    // Footer
    h(Box, { paddingX: 1 },
      h(Text, { dimColor: true },
        phase === 'idle' ? '↑↓ scroll  ↵ send  esc back' :
        phase === 'reviewing' ? (pendingCode ? 'a save as automation  c continue  d discard' : 'c continue  d discard') :
        phase === 'saving' ? '↵ confirm  esc cancel' : '',
      ),
    ),
  );
}
