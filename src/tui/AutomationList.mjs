import React, { useState, useRef } from 'react';
import { Box, Text, useInput, useWindowSize } from 'ink';
import {
  listAutomations, loadAutomation, deleteAutomation,
  loadProfilesForGroup, getGroups, runCode,
} from '../automations.mjs';

const h = React.createElement;

export default function AutomationList({ onBack, onKimi }) {
  const { rows }  = useWindowSize();

  const [phase,         setPhase        ] = useState('list');
  const [automations,   setAutomations  ] = useState(() => listAutomations());
  const [cursor,        setCursor       ] = useState(0);
  const [groups,        setGroups       ] = useState(() => ['all', ...getGroups()]);
  const [groupCursor,   setGroupCursor  ] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [status,        setStatus       ] = useState(null);
  const [result,        setResult       ] = useState(null);
  const [error,         setError        ] = useState(null);
  const [scroll,        setScroll       ] = useState(0);

  const resultLines = result != null
    ? JSON.stringify(result, null, 2).split('\n')
    : [];
  const listHeight  = Math.max(1, rows - 6);
  const selected    = automations[cursor];

  const refresh = () => {
    const updated = listAutomations();
    setAutomations(updated);
    setCursor(c => Math.min(c, Math.max(0, updated.length - 1)));
  };

  async function runSelected() {
    const auto = loadAutomation(selected);
    const g    = groups[groupCursor];
    setStatus(`loading ${g === 'all' ? 'all profiles' : `"${g}"`}…`);
    setPhase('running');
    try {
      const profiles = loadProfilesForGroup(g);
      setStatus(`running "${selected}" on ${profiles.length} profiles…`);
      const out = await runCode(auto.code, profiles);
      setResult(out ?? null);
      setError(null);
    } catch (e) {
      setResult(null);
      setError(e.message);
    }
    setStatus(null);
    setPhase('result');
  }

  useInput((input, key) => {
    if (phase === 'list') {
      if (key.escape || input === 'q') { onBack(); return; }
      if (key.upArrow)   { setCursor(c => Math.max(0, c - 1)); return; }
      if (key.downArrow) { setCursor(c => Math.min(automations.length - 1, c + 1)); return; }
      if (input === 'k')             { onKimi?.(); return; }
      if (input === 'd' && selected) { setConfirmDelete(true); return; }
      if (key.return && selected)    { setGroupCursor(0); setPhase('pick-group'); return; }
      return;
    }

    if (phase === 'list' && confirmDelete) {
      if (input === 'y') {
        deleteAutomation(selected);
        refresh();
        setConfirmDelete(false);
        return;
      }
      if (input === 'n' || key.escape) { setConfirmDelete(false); return; }
      return;
    }

    if (phase === 'pick-group') {
      if (key.escape)    { setPhase('list'); return; }
      if (key.upArrow)   { setGroupCursor(c => Math.max(0, c - 1)); return; }
      if (key.downArrow) { setGroupCursor(c => Math.min(groups.length - 1, c + 1)); return; }
      if (key.return)    { runSelected(); return; }
      return;
    }

    if (phase === 'running') {
      // no input while running
      return;
    }

    if (phase === 'result') {
      if (key.escape || input === 'q') { setPhase('list'); setResult(null); setError(null); return; }
      if (key.upArrow)   { setScroll(s => Math.max(0, s - 1)); return; }
      if (key.downArrow) { setScroll(s => Math.min(Math.max(0, resultLines.length - listHeight), s + 1)); return; }
      return;
    }
  });

  // ── Render ────────────────────────────────────────────────────────────────

  if (phase === 'pick-group') {
    return h(Box, { flexDirection: 'column' },
      h(Box, { paddingX: 1 },
        h(Text, { bold: true }, `Run "${selected}"`),
      ),
      h(Box, { paddingX: 1 }, h(Text, { dimColor: true }, 'which profiles?')),
      h(Box, { height: 1 }),
      ...groups.map((g, i) =>
        h(Box, { key: g, paddingX: 2 },
          h(Text, { inverse: i === groupCursor }, `${i === groupCursor ? '▸' : ' '} ${g}`),
        )
      ),
      h(Box, { paddingX: 1, marginTop: 1 },
        h(Text, { dimColor: true }, '↑↓ navigate  ↵ run  esc back'),
      ),
    );
  }

  if (phase === 'running') {
    return h(Box, { flexDirection: 'column' },
      h(Box, { paddingX: 1 }, h(Text, { bold: true }, 'Running…')),
      h(Box, { paddingX: 2 }, h(Text, { color: 'yellow' }, status ?? '')),
    );
  }

  if (phase === 'result') {
    const visibleLines = resultLines.slice(scroll, scroll + listHeight);
    return h(Box, { flexDirection: 'column' },
      h(Box, { paddingX: 1 },
        h(Text, { bold: true }, `Result: ${selected}`),
        error ? h(Text, { color: 'red' }, '  ✗ error') : null,
      ),
      h(Box, { flexDirection: 'column', paddingX: 2, flexGrow: 1 },
        error
          ? h(Box, {}, h(Text, { color: 'red' }, error))
          : result == null
            ? h(Box, {}, h(Text, { dimColor: true }, '(no output collected)'))
            : visibleLines.map((l, i) => h(Box, { key: i }, h(Text, {}, l))),
      ),
      h(Box, { paddingX: 1, marginTop: 1 },
        h(Text, { dimColor: true }, '↑↓ scroll  esc/q back'),
      ),
    );
  }

  // List view
  if (confirmDelete) {
    return h(Box, { flexDirection: 'column' },
      h(Box, { paddingX: 1 }, h(Text, { bold: true }, 'Automations')),
      h(Box, { height: 1 }),
      h(Box, { paddingX: 2 },
        h(Text, { color: 'red' }, `Delete "${selected}"? `),
        h(Text, {}, 'y / n'),
      ),
    );
  }

  return h(Box, { flexDirection: 'column' },
    h(Box, { paddingX: 1 },
      h(Text, { bold: true, color: 'cyan' }, 'Automations  '),
      h(Text, { dimColor: true }, `${automations.length} total`),
    ),
    h(Box, { flexDirection: 'column' },
      automations.length === 0
        ? h(Box, { paddingX: 2 }, h(Text, { dimColor: true }, 'no automations yet — build one with kimi (k)'))
        : automations.slice(0, listHeight).map((a, i) => {
            const active = i === cursor;
            const meta   = (() => { try { return loadAutomation(a); } catch { return {}; } })();
            const desc   = meta.description ? `  ${meta.description}` : '';
            return h(Box, { key: a, paddingX: 1 },
              h(Text, { inverse: active }, `${active ? '▸' : ' '} ${a}${desc}`),
            );
          }),
    ),
    h(Box, { paddingX: 1, marginTop: 1 },
      h(Text, { dimColor: true }, '↵ run  d delete  k kimi  esc back'),
    ),
  );
}
