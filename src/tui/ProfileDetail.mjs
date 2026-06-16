import React, { useState, useMemo } from 'react';
import { Box, Text, useInput, useWindowSize } from 'ink';
import { getAttributes, deleteProfile } from '../db.mjs';

const h = React.createElement;

const TYPE_ORDER = [
  'group', 'connection_level', 'met', 'date_added',
  'email', 'phone', 'website', 'social',
  'company', 'profession',
  'podcast', 'interest',
  'related_to', 'with',
  'note', 'proposal', 'promise',
  'message', 'card',
];

const LABEL = {
  group:            'group',
  connection_level: 'connection',
  met:              'met',
  date_added:       'added',
  email:            'email',
  phone:            'phone',
  website:          'website',
  social:           'social',
  company:          'company',
  profession:       'profession',
  podcast:          'podcast',
  interest:         'interest',
  related_to:       'related to',
  with:             'with',
  note:             'note',
  proposal:         'proposal',
  promise:          'promise',
  message:          'message',
  card:             'card',
};

function formatValue(type, data) {
  const v = JSON.parse(data);
  if (typeof v === 'string') return v;
  switch (type) {
    case 'email':   return [v.address, v.label].filter(Boolean).join('  ');
    case 'phone':   return [v.number,  v.label].filter(Boolean).join('  ');
    case 'website': return [v.url,     v.label].filter(Boolean).join('  ');
    case 'social':  return [v.url,     v.label, v.status].filter(Boolean).join('  ');
    case 'message': return [v.channel, v.dateSent, v.text].filter(Boolean).join('  ·  ');
    default:        return JSON.stringify(v);
  }
}

// Returns an array of {label, value} entries with null as section separators.
function buildLines(attrs) {
  const byType = new Map();
  for (const a of attrs) {
    if (a.type === 'first_name' || a.type === 'last_name') continue;
    if (!byType.has(a.type)) byType.set(a.type, []);
    byType.get(a.type).push(a);
  }

  const lines     = [];
  let   needsSep  = false;

  const flush = (type, items) => {
    if (!items?.length) return;
    if (needsSep) lines.push(null);
    for (const item of items) {
      lines.push({ label: LABEL[type] ?? type, value: formatValue(type, item.data) });
    }
    needsSep = true;
  };

  for (const type of TYPE_ORDER) {
    flush(type, byType.get(type));
    byType.delete(type);
  }
  for (const [type, items] of byType) flush(type, items);

  return lines;
}

export default function ProfileDetail({ profileId, onBack, onEdit, onSendEmail, onDelete }) {
  const { rows }                        = useWindowSize();
  const [offset, setOffset]             = useState(0);
  const [confirming, setConfirming]     = useState(false);

  const attrs = useMemo(() => getAttributes(profileId), [profileId]);
  const lines = useMemo(() => buildLines(attrs), [attrs]);

  const firstName = attrs.find(a => a.type === 'first_name');
  const lastName  = attrs.find(a => a.type === 'last_name');
  const name = [
    firstName ? JSON.parse(firstName.data) : null,
    lastName  ? JSON.parse(lastName.data)  : null,
  ].filter(Boolean).join(' ') || '(unnamed)';

  // header(1) + footer(1) + marginTop(1) + padding(2)
  const contentHeight = Math.max(1, rows - 5);
  const maxOffset     = Math.max(0, lines.length - contentHeight);

  useInput((input, key) => {
    if (confirming) {
      if (input === 'y') { deleteProfile(profileId); onDelete?.(); return; }
      if (input === 'n' || key.escape) { setConfirming(false); return; }
      return;
    }
    if (key.escape || input === 'q') { onBack(); return; }
    if (input === 'i')               { onEdit?.(); return; }
    if (input === 'e')               { onSendEmail?.(profileId); return; }
    if (input === 'd')               { setConfirming(true); return; }
    if (key.upArrow)                 { setOffset(o => Math.max(0, o - 1)); return; }
    if (key.downArrow)               { setOffset(o => Math.min(maxOffset, o + 1)); return; }
  });

  const visible  = lines.slice(offset, offset + contentHeight);
  const LABEL_W  = 14;

  return h(Box, { flexDirection: 'column', height: rows },
    h(Box, { paddingX: 1 },
      h(Text, { bold: true }, name),
    ),

    h(Box, { flexDirection: 'column', paddingX: 2, marginTop: 1, flexGrow: 1 },
      ...visible.map((line, i) =>
        line === null
          ? h(Box, { key: `sep-${offset + i}` }, h(Text, {}, ' '))
          : h(Box, { key: `${offset + i}` },
              h(Box, { width: LABEL_W },
                h(Text, { dimColor: true }, line.label),
              ),
              h(Text, {}, line.value),
            )
      ),
    ),

    confirming
      ? h(Box, { paddingX: 1 },
          h(Text, { color: 'red' }, `Delete ${name}? `),
          h(Text, {}, 'y / n'),
        )
      : h(Box, { paddingX: 1 },
          h(Text, { color: 'cyan' }, 'i'),
          h(Text, { dimColor: true }, ' edit  '),
          h(Text, { color: 'cyan' }, 'e'),
          h(Text, { dimColor: true }, ' email  '),
          h(Text, { color: 'cyan' }, 'd'),
          h(Text, { dimColor: true }, ' delete  ↑↓ scroll  esc/q back'),
        ),
  );
}
