import React, { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { getGroups, createProfile } from '../db.mjs';

const h = React.createElement;

const FIELDS = [
  { key: 'first_name', label: 'first name', required: true },
  { key: 'last_name',  label: 'last name'  },
  { key: 'group',      label: 'group'      },
  { key: 'email',      label: 'email'      },
  { key: 'phone',      label: 'phone'      },
  { key: 'company',    label: 'company'    },
  { key: 'profession', label: 'profession' },
  { key: 'location',   label: 'location'  },
  { key: 'note',       label: 'note'       },
];

const LABEL_W = 14;

function buildAttrs(values) {
  const attrs = [];
  const add   = (type, data) => attrs.push({ type, data: JSON.stringify(data) });

  if (values.first_name) add('first_name', values.first_name);
  if (values.last_name)  add('last_name',  values.last_name);
  if (values.group)      add('group',      values.group);
  if (values.email)      add('email',      { address: values.email, label: '' });
  if (values.phone)      add('phone',      { number:  values.phone, label: '' });
  if (values.company)    add('company',    values.company);
  if (values.profession) add('profession', values.profession);
  if (values.location)   add('location',   { city: values.location, region: '', country: '', label: '' });
  if (values.note)       add('note',       values.note);

  return attrs;
}

export default function CreateProfile({ onSave, onBack }) {
  const groups = useMemo(() => getGroups(), []);

  const [values,   setValues]   = useState(
    Object.fromEntries(FIELDS.map(f => [f.key, '']))
  );
  const [fieldIdx, setFieldIdx] = useState(0);

  const canSave = values.first_name.trim().length > 0;

  function save() {
    if (!canSave) return;
    const attrs     = buildAttrs(
      Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim()]))
    );
    const profileId = createProfile(attrs);
    onSave(profileId);
  }

  useInput((input, key) => {
    if (key.escape) { onBack(); return; }

    // ctrl+s saves from any field
    if (key.ctrl && input === 's') { save(); return; }

    const isLast  = fieldIdx === FIELDS.length - 1;
    const focused = FIELDS[fieldIdx].key;

    // navigation
    if (key.tab || key.downArrow || (key.return && !isLast)) {
      setFieldIdx(i => Math.min(FIELDS.length - 1, i + 1));
      return;
    }
    if (key.upArrow) {
      setFieldIdx(i => Math.max(0, i - 1));
      return;
    }
    if (key.return && isLast) { save(); return; }

    // text editing
    if (key.backspace || key.delete) {
      setValues(v => ({ ...v, [focused]: v[focused].slice(0, -1) }));
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      setValues(v => ({ ...v, [focused]: v[focused] + input }));
      return;
    }
  });

  return h(Box, { flexDirection: 'column' },
    h(Box, { paddingX: 1 }, h(Text, { bold: true }, 'New profile')),
    h(Box, { height: 1 }),

    ...FIELDS.map((f, i) => {
      const active = i === fieldIdx;
      const isLast = i === FIELDS.length - 1;
      return h(Box, { key: f.key, paddingX: 2 },
        h(Box, { width: LABEL_W },
          h(Text, { dimColor: !active, color: active ? 'cyan' : undefined },
            f.label + (f.required ? ' *' : ''),
          ),
        ),
        h(Text, { color: active ? 'yellow' : undefined },
          values[f.key] + (active ? '█' : ''),
        ),
        active && isLast
          ? h(Text, { dimColor: true }, '  ↵ to save')
          : null,
      );
    }),

    groups.length > 0
      ? h(Box, { paddingX: 2, marginTop: 1 },
          h(Text, { dimColor: true }, `groups: ${groups.join('  ·  ')}`),
        )
      : null,

    !canSave
      ? h(Box, { paddingX: 2, marginTop: 1 },
          h(Text, { dimColor: true }, '* first name required'),
        )
      : null,

    h(Box, { paddingX: 1, marginTop: 1 },
      h(Text, { dimColor: true }, '↓/tab next  ↑ prev  ↵ save (last field)  ctrl+s save  esc cancel'),
    ),
  );
}
