import React, { useState, useMemo, useEffect } from 'react';
import { Box, Text, useInput, useApp, useWindowSize } from 'ink';
import { getProfiles } from '../db.mjs';

const h = React.createElement;

export default function ProfileList({ onSelect, onNew, onBlast, onTemplates, onAgents, onKimi, onAutomations }) {
  const { exit }          = useApp();
  const { columns, rows } = useWindowSize();

  const [search,     setSearch]     = useState('');
  const [searchMode, setSearchMode] = useState(false);
  const [cursor,     setCursor]     = useState(0);
  const [offset,     setOffset]     = useState(0);

  const all      = useMemo(() => getProfiles(), []);
  const filtered = useMemo(() => {
    if (!search) return all;
    const q = search.toLowerCase();
    return all.filter(p =>
      (p.first_name ?? '').toLowerCase().includes(q) ||
      (p.last_name  ?? '').toLowerCase().includes(q) ||
      (p.group_name ?? '').toLowerCase().includes(q)
    );
  }, [search, all]);

  // title(1) + search(1) + footer(1) + marginTop(1) + padding(1)
  const listHeight = Math.max(1, rows - 5);

  useEffect(() => {
    const max = Math.max(0, filtered.length - 1);
    if (cursor > max) setCursor(max);
  }, [filtered.length]);

  useEffect(() => {
    if (cursor < offset)               setOffset(cursor);
    if (cursor >= offset + listHeight) setOffset(cursor - listHeight + 1);
  }, [cursor, offset, listHeight]);

  useInput((input, key) => {
    if (searchMode) {
      if (key.escape)                      { setSearch(''); setSearchMode(false); return; }
      if (key.return)                      { setSearchMode(false); return; }
      if (key.upArrow)                     { setCursor(c => Math.max(0, c - 1)); return; }
      if (key.downArrow)                   { setCursor(c => Math.min(filtered.length - 1, c + 1)); return; }
      if (key.backspace || key.delete)     { setSearch(s => s.slice(0, -1)); return; }
      if (input && !key.ctrl && !key.meta) { setSearch(s => s + input); return; }
      return;
    }
    if (input === '/')                            { setSearchMode(true); return; }
    if (input === 'n')                            { onNew?.(); return; }
    if (input === 'b')                            { onBlast?.(); return; }
    if (input === 'q')                            { exit(); return; }
    if (input === 't')                            { onTemplates?.(); return; }
    if (input === 'a')                            { onAgents?.(); return; }
    if (input === 'k')                            { onKimi?.(); return; }
    if (input === 'r')                            { onAutomations?.(); return; }
    if (key.upArrow)                              { setCursor(c => Math.max(0, c - 1)); return; }
    if (key.downArrow)                            { setCursor(c => Math.min(filtered.length - 1, c + 1)); return; }
    if (key.return && filtered.length > 0)        { onSelect(filtered[cursor].id); return; }
  });

  const visible   = filtered.slice(offset, offset + listHeight);
  const nameWidth = Math.max(20, Math.floor(columns * 0.55));

  return h(Box, { flexDirection: 'column' },
    h(Box, { paddingX: 1 },
      h(Text, { bold: true, color: 'cyan' }, 'comms  '),
      h(Text, { dimColor: true },
        filtered.length !== all.length
          ? `${filtered.length}/${all.length} profiles`
          : `${all.length} profiles`,
      ),
    ),

    h(Box, { paddingX: 1 },
      h(Text, { color: searchMode ? 'yellow' : 'gray' }, '/ '),
      h(Text, { color: searchMode ? 'yellow' : undefined }, search),
      searchMode
        ? h(Text, { color: 'yellow' }, '█')
        : !search
          ? h(Text, { dimColor: true }, 'search...')
          : null,
    ),

    ...visible.map((p, i) => {
      const idx    = offset + i;
      const active = idx === cursor;
      const name   = [p.first_name, p.last_name].filter(Boolean).join(' ') || '(unnamed)';
      const trunc  = name.length > nameWidth ? name.slice(0, nameWidth - 1) + '…' : name;
      const line   = `${active ? '▸' : ' '} ${trunc.padEnd(nameWidth)}  ${p.group_name ?? ''}`;
      return h(Box, { key: p.id, paddingX: 1 },
        h(Text, { inverse: active }, line),
      );
    }),

    filtered.length === 0
      ? h(Box, { paddingX: 3 }, h(Text, { dimColor: true }, 'no results'))
      : null,

    h(Box, { paddingX: 1, marginTop: 1 },
      h(Text, { dimColor: true }, 'n new  b blast  / search  ↑↓ navigate  ↵ open  t templates  a agents  k kimi  r automations  q quit'),
    ),
  );
}
