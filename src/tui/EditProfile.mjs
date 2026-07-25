import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, useWindowSize } from 'ink';
import { getAttributes, addAttribute, updateAttribute, deleteAttribute, getRelationships, addRelationship, deleteRelationship, getProfiles } from '../db.mjs';

const h = React.createElement;

const TYPES = [
  'note', 'email', 'phone', 'company', 'profession',
  'interest', 'group', 'website', 'social',
  'proposal', 'promise',
  'podcast', 'met', 'connection_level', 'date_added',
  'first_name', 'last_name', 'card',
];

const LABEL = {
  first_name: 'first name', last_name: 'last name', group: 'group',
  connection_level: 'connection', met: 'met', date_added: 'date added',
  email: 'email', phone: 'phone', website: 'website', social: 'social',
  company: 'company', profession: 'profession', podcast: 'podcast',
  interest: 'interest', related_to: 'related to', with: 'with',
  note: 'note', proposal: 'proposal', promise: 'promise', card: 'card',
};

const REL_TYPES = ['related_to', 'with'];

const REL_LABEL = {
  related_to: 'related to',
  with:       'with',
};

const LABEL_W = 16;

// The display string shown in the list for an attribute
function displayVal(type, data) {
  const v = JSON.parse(data);
  if (typeof v === 'string') return v;
  switch (type) {
    case 'email':   return v.address ?? '';
    case 'phone':   return v.number  ?? '';
    case 'website': return v.url     ?? '';
    case 'social':  return [v.url, v.status ? `[${v.status}]` : ''].filter(Boolean).join(' ');
    case 'message': return (v.text ?? '').slice(0, 50);
    default:        return JSON.stringify(v).slice(0, 50);
  }
}

// The editable string for the primary field of an attribute
function getPrimary(type, data) {
  const v = JSON.parse(data);
  if (typeof v === 'string') return v;
  switch (type) {
    case 'email':            return v.address ?? '';
    case 'phone':            return v.number  ?? '';
    case 'website':
    case 'social':           return v.url     ?? '';
    case 'message':          return v.text    ?? '';
    default:                 return JSON.stringify(v);
  }
}

// Merge the edited primary value back into existing data
function mergePrimary(type, existingData, newVal) {
  const v = JSON.parse(existingData);
  if (typeof v === 'string') return JSON.stringify(newVal);
  switch (type) {
    case 'email':   return JSON.stringify({ ...v, address: newVal });
    case 'phone':   return JSON.stringify({ ...v, number:  newVal });
    case 'website':
    case 'social':  return JSON.stringify({ ...v, url:     newVal });
    case 'message': return JSON.stringify({ ...v, text:    newVal });
    default:        return JSON.stringify(newVal);
  }
}

// Fresh data string for a brand-new attribute
function freshData(type, val) {
  switch (type) {
    case 'email':   return JSON.stringify({ address: val, label: '' });
    case 'phone':   return JSON.stringify({ number: val,  label: '' });
    case 'website': return JSON.stringify({ url: val,     label: '' });
    case 'social':  return JSON.stringify({ url: val, label: '', status: '', lastChecked: '' });
    case 'message': return JSON.stringify({ text: val, channel: '', dateSent: new Date().toISOString().slice(0, 10), status: '', templateName: '' });
    default:        return JSON.stringify(val);
  }
}

export default function EditProfile({ profileId, onBack }) {
  const { rows } = useWindowSize();

  const [attrs,      setAttrs]      = useState(() => getAttributes(profileId));
  const [rels,       setRels]       = useState(() => getRelationships(profileId));
  const [mode,       setMode]       = useState('browse'); // browse | editing | adding-type | adding-value | adding-rel-type | adding-rel-profile | confirm-delete
  const [cursor,     setCursor]     = useState(0);
  const [offset,     setOffset]     = useState(0);
  const [typeCursor, setTypeCursor] = useState(0);
  const [typeOffset, setTypeOffset] = useState(0);
  const [inputVal,   setInputVal]   = useState('');
  const [addingType, setAddingType] = useState(null);
  const [addingRelType, setAddingRelType] = useState(null);
  const [profileCursor, setProfileCursor] = useState(0);
  const [profileOffset, setProfileOffset] = useState(0);
  const [profileSearch, setProfileSearch] = useState('');

  const refresh = () => {
    setAttrs(getAttributes(profileId));
    setRels(getRelationships(profileId));
  };

  const firstName = attrs.find(a => a.type === 'first_name');
  const lastName  = attrs.find(a => a.type === 'last_name');
  const name = [
    firstName && JSON.parse(firstName.data),
    lastName  && JSON.parse(lastName.data),
  ].filter(Boolean).join(' ') || '(unnamed)';

  // Build combined browsable list: attributes first, then relationships
  const items = useMemo(() => {
    const attrItems = attrs
      .filter(a => a.type !== 'first_name' && a.type !== 'last_name')
      .map(a => ({ _kind: 'attr', ...a }));
    const relItems = rels.map(r => ({
      _kind: 'rel',
      id: r.id,
      type: r.type,
      linked_name: r.linked_name,
      linked_profile_id: r.linked_profile_id,
    }));
    return [...attrItems, ...relItems];
  }, [attrs, rels]);

  // All profiles for the relationship picker (excluding self)
  const allProfiles = useMemo(() => getProfiles().filter(p => p.id !== profileId), [profileId]);
  const filteredProfiles = useMemo(() => {
    if (!profileSearch) return allProfiles;
    const q = profileSearch.toLowerCase();
    return allProfiles.filter(p =>
      (p.first_name ?? '').toLowerCase().includes(q) ||
      (p.last_name  ?? '').toLowerCase().includes(q)
    );
  }, [allProfiles, profileSearch]);

  // Keep browse cursor in the scroll window
  const listHeight = Math.max(1, rows - 5);
  useEffect(() => {
    if (cursor < offset)               setOffset(cursor);
    if (cursor >= offset + listHeight) setOffset(cursor - listHeight + 1);
  }, [cursor, offset, listHeight]);

  const typeListHeight = Math.max(1, rows - 5);
  useEffect(() => {
    if (typeCursor < typeOffset)                   setTypeOffset(typeCursor);
    if (typeCursor >= typeOffset + typeListHeight) setTypeOffset(typeCursor - typeListHeight + 1);
  }, [typeCursor, typeOffset, typeListHeight]);

  const profileListHeight = Math.max(1, rows - 6);
  useEffect(() => {
    if (profileCursor < profileOffset)                       setProfileOffset(profileCursor);
    if (profileCursor >= profileOffset + profileListHeight)  setProfileOffset(profileCursor - profileListHeight + 1);
  }, [profileCursor, profileOffset, profileListHeight]);

  useInput((input, key) => {

    // ── browse ──────────────────────────────────────────────────────────────
    if (mode === 'browse') {
      if (key.escape || input === 'q') { onBack(); return; }
      if (key.upArrow)                 { setCursor(c => Math.max(0, c - 1)); return; }
      if (key.downArrow)               { setCursor(c => Math.min(items.length - 1, c + 1)); return; }
      if (input === 'a')               { setTypeCursor(0); setTypeOffset(0); setMode('adding-type'); return; }
      if (input === 'r')               { setAddingRelType('related_to'); setProfileSearch(''); setProfileCursor(0); setProfileOffset(0); setMode('adding-rel-profile'); return; }
      if (input === 'd' && items[cursor]) { setMode('confirm-delete'); return; }
      if ((key.return || input === 'e') && items[cursor]) {
        if (items[cursor]._kind === 'attr') {
          setInputVal(getPrimary(items[cursor].type, items[cursor].data));
          setMode('editing');
        }
        return;
      }
      return;
    }

    // ── editing (attributes only) ────────────────────────────────────────────
    if (mode === 'editing') {
      if (key.escape)                      { setMode('browse'); return; }
      if (key.return) {
        const item = items[cursor];
        if (item?._kind === 'attr') {
          updateAttribute(item.id, mergePrimary(item.type, item.data, inputVal));
          refresh();
        }
        setMode('browse');
        return;
      }
      if (key.backspace || key.delete)     { setInputVal(v => v.slice(0, -1)); return; }
      if (input && !key.ctrl && !key.meta) { setInputVal(v => v + input); return; }
      return;
    }

    // ── adding-type (pick attribute type) ────────────────────────────────────
    if (mode === 'adding-type') {
      if (key.escape)    { setMode('browse'); return; }
      if (key.upArrow)   { setTypeCursor(c => Math.max(0, c - 1)); return; }
      if (key.downArrow) { setTypeCursor(c => Math.min(TYPES.length - 1, c + 1)); return; }
      if (key.return)    { setAddingType(TYPES[typeCursor]); setInputVal(''); setMode('adding-value'); return; }
      return;
    }

    // ── adding-value (new attribute value) ───────────────────────────────────
    if (mode === 'adding-value') {
      if (key.escape)                      { setMode('adding-type'); return; }
      if (key.return) {
        if (inputVal.trim()) {
          addAttribute(profileId, addingType, freshData(addingType, inputVal.trim()));
          refresh();
          setCursor(items.length);
        }
        setMode('browse');
        return;
      }
      if (key.backspace || key.delete)     { setInputVal(v => v.slice(0, -1)); return; }
      if (input && !key.ctrl && !key.meta) { setInputVal(v => v + input); return; }
      return;
    }

    // ── adding-rel-profile (pick profile for relationship) ───────────────────
    if (mode === 'adding-rel-profile') {
      if (key.escape)                      { setMode('browse'); return; }
      if (key.return && filteredProfiles.length > 0) {
        const target = filteredProfiles[profileCursor];
        addRelationship(profileId, target.id, addingRelType);
        refresh();
        setMode('browse');
        return;
      }
      if (key.upArrow)                     { setProfileCursor(c => Math.max(0, c - 1)); return; }
      if (key.downArrow)                   { setProfileCursor(c => Math.min(filteredProfiles.length - 1, c + 1)); return; }
      if (key.backspace || key.delete)     { setProfileSearch(s => s.slice(0, -1)); setProfileCursor(0); return; }
      if (input && !key.ctrl && !key.meta) { setProfileSearch(s => s + input); setProfileCursor(0); return; }
      return;
    }

    // ── confirm-delete ────────────────────────────────────────────────────────
    if (mode === 'confirm-delete') {
      if (input === 'y') {
        const item = items[cursor];
        if (item?._kind === 'attr') {
          deleteAttribute(item.id);
        } else if (item?._kind === 'rel') {
          deleteRelationship(item.id);
        }
        refresh();
        setCursor(c => Math.max(0, c - 1));
        setMode('browse');
        return;
      }
      if (input === 'n' || key.escape) { setMode('browse'); return; }
      return;
    }
  });

  // ── type picker ────────────────────────────────────────────────────────────
  if (mode === 'adding-type') {
    const visible = TYPES.slice(typeOffset, typeOffset + typeListHeight);
    return h(Box, { flexDirection: 'column' },
      h(Box, { paddingX: 1 }, h(Text, { bold: true }, 'Add attribute — pick type')),
      h(Box, { height: 1 }),
      ...visible.map((t, i) => {
        const idx    = typeOffset + i;
        const active = idx === typeCursor;
        return h(Box, { key: t, paddingX: 1 },
          h(Text, { inverse: active }, `${active ? '▸' : ' '} ${LABEL[t] ?? t}`),
        );
      }),
      h(Box, { paddingX: 1, marginTop: 1 },
        h(Text, { dimColor: true }, '↑↓ pick  ↵ select  esc cancel'),
      ),
    );
  }

  // ── value input (adding attribute) ─────────────────────────────────────────
  if (mode === 'adding-value') {
    return h(Box, { flexDirection: 'column' },
      h(Box, { paddingX: 1 },
        h(Text, { bold: true }, 'Add '),
        h(Text, { bold: true, color: 'cyan' }, LABEL[addingType] ?? addingType),
      ),
      h(Box, { height: 1 }),
      h(Box, { paddingX: 2 },
        h(Text, { color: 'yellow' }, inputVal + '█'),
      ),
      h(Box, { paddingX: 1, marginTop: 1 },
        h(Text, { dimColor: true }, '↵ save  esc back'),
      ),
    );
  }

  // ── profile picker (adding relationship) ──────────────────────────────────
  if (mode === 'adding-rel-profile') {
    const visible = filteredProfiles.slice(profileOffset, profileOffset + profileListHeight);
    return h(Box, { flexDirection: 'column' },
      h(Box, { paddingX: 1 },
        h(Text, { bold: true }, 'Link '),
        h(Text, { bold: true, color: 'cyan' }, REL_LABEL[addingRelType] ?? addingRelType),
        h(Text, { bold: true }, ' — pick profile'),
      ),
      h(Box, { paddingX: 1 },
        h(Text, { color: 'yellow' }, profileSearch + '█'),
        h(Text, { dimColor: true }, '  type to search'),
      ),
      ...visible.map((p, i) => {
        const idx    = profileOffset + i;
        const active = idx === profileCursor;
        const pname  = [p.first_name, p.last_name].filter(Boolean).join(' ') || '(unnamed)';
        return h(Box, { key: p.id, paddingX: 1 },
          h(Text, { inverse: active }, `${active ? '▸' : ' '} ${pname}`),
        );
      }),
      filteredProfiles.length === 0
        ? h(Box, { paddingX: 3 }, h(Text, { dimColor: true }, 'no matching profiles'))
        : null,
      h(Box, { paddingX: 1, marginTop: 1 },
        h(Text, { dimColor: true }, '↑↓ navigate  ↵ select  esc cancel'),
      ),
    );
  }

  // ── browse / editing ───────────────────────────────────────────────────────
  const visible = items.slice(offset, offset + listHeight);

  return h(Box, { flexDirection: 'column' },
    h(Box, { paddingX: 1 },
      h(Text, { bold: true }, name),
      h(Text, { dimColor: true }, '  edit'),
    ),

    h(Box, { flexDirection: 'column' },
      items.length === 0
        ? h(Box, { paddingX: 2 }, h(Text, { dimColor: true }, 'no attributes — press a to add'))
        : visible.map((item, i) => {
            const idx    = offset + i;
            const active = idx === cursor;
            const isAttr = item._kind === 'attr';
            const label  = isAttr
              ? (LABEL[item.type] ?? item.type).padEnd(LABEL_W)
              : (REL_LABEL[item.type] ?? item.type).padEnd(LABEL_W);
            const value  = isAttr
              ? displayVal(item.type, item.data)
              : (item.linked_name?.trim() || `(profile #${item.linked_profile_id})`);
            const key    = isAttr ? `a-${item.id}` : `r-${item.id}`;

            if (active && mode === 'editing' && isAttr) {
              return h(Box, { key, paddingX: 1 },
                h(Box, { width: LABEL_W + 1 },
                  h(Text, { color: 'cyan' }, `▸ ${label}`),
                ),
                h(Text, { color: 'yellow' }, inputVal + '█'),
                h(Text, { dimColor: true }, '  ↵ save  esc cancel'),
              );
            }

            if (active && mode === 'confirm-delete') {
              return h(Box, { key, paddingX: 1 },
                h(Text, { color: 'red' }, `▸ ${label}`),
                h(Text, { color: 'red' }, value),
                h(Text, { color: 'red' }, '  delete? y/n'),
              );
            }

            return h(Box, { key, paddingX: 1 },
              h(Box, { width: LABEL_W + 2 },
                h(Text, { inverse: active && mode === 'browse' },
                  `${active ? '▸' : ' '} ${label}`,
                ),
              ),
              h(Text, { dimColor: !active || item._kind === 'rel' }, value),
            );
          }),
    ),

    h(Box, { paddingX: 1, marginTop: 1 },
      h(Text, { dimColor: true }, 'a add attr  r add rel  ↵/e edit  d delete  esc back'),
    ),
  );
}
