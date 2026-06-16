import React, { useState, useMemo } from 'react';
import { Box, Text, useInput, useWindowSize } from 'ink';
import {
  listTemplates, parseTemplate, templatePath,
  writeTemplateSkeleton, deleteTemplate, listEmailAccounts,
  isMarkdownTemplate,
} from '../templates.mjs';

const h = React.createElement;

export default function TemplateList({ onBack, onEdit }) {
  const { rows }           = useWindowSize();
  const [mode, setMode]    = useState('list'); // 'list' | 'creating' | 'confirming-delete'
  const [cursor, setCursor]  = useState(0);
  const [templates, setTemplates] = useState(() => listTemplates());

  // form state
  const accounts       = useMemo(() => listEmailAccounts(), []);
  const [form, setForm]       = useState({ name: '', subject: '' });
  const [accountIdx, setAccountIdx] = useState(0);
  const [markdown, setMarkdown]     = useState(false);
  const [field, setField]     = useState('name'); // 'name' | 'subject' | 'from' | 'format'

  const refresh = () => setTemplates(listTemplates());

  const selected = templates[cursor];

  function submitCreate() {
    const { name, subject } = form;
    if (!name.trim()) return;
    writeTemplateSkeleton(name.trim(), subject.trim(), accounts[accountIdx].key, markdown);
    onEdit(templatePath(name.trim()), 'templates');
  }

  useInput((input, key) => {
    if (mode === 'list') {
      if (key.escape || input === 'q')    { onBack(); return; }
      if (key.upArrow)                    { setCursor(c => Math.max(0, c - 1)); return; }
      if (key.downArrow)                  { setCursor(c => Math.min(templates.length - 1, c + 1)); return; }
      if (input === 'n')                  { setForm({ name: '', subject: '' }); setField('name'); setAccountIdx(0); setMode('creating'); return; }
      if (input === 'e' && selected)      { onEdit(templatePath(selected), 'templates'); return; }
      if (input === 'd' && selected)      { setMode('confirming-delete'); return; }
      if (key.return && selected)         { onEdit(templatePath(selected), 'templates'); return; }
      return;
    }

    if (mode === 'confirming-delete') {
      if (input === 'y')   { deleteTemplate(selected); refresh(); setCursor(c => Math.min(c, templates.length - 2)); setMode('list'); return; }
      if (input === 'n' || key.escape) { setMode('list'); return; }
      return;
    }

    if (mode === 'creating') {
      if (key.escape) { setMode('list'); return; }

      if (field === 'from') {
        if (key.leftArrow)  { setAccountIdx(i => (i - 1 + accounts.length) % accounts.length); return; }
        if (key.rightArrow) { setAccountIdx(i => (i + 1) % accounts.length); return; }
        if (key.return || key.tab) { setField('format'); return; }
        if (key.upArrow)    { setField('subject'); return; }
        return;
      }

      if (field === 'format') {
        if (key.leftArrow || key.rightArrow || input === ' ') { setMarkdown(m => !m); return; }
        if (key.return || key.tab) { submitCreate(); return; }
        if (key.upArrow)  { setField('from'); return; }
        return;
      }

      if (key.return || key.tab) {
        setField(f => f === 'name' ? 'subject' : 'from');
        return;
      }
      if (key.backspace || key.delete) {
        setForm(f => ({ ...f, [field]: f[field].slice(0, -1) }));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setForm(f => ({ ...f, [field]: f[field] + input }));
        return;
      }
    }
  });

  const listHeight = Math.max(1, rows - 6);

  if (mode === 'creating') {
    const acc = accounts[accountIdx];
    return h(Box, { flexDirection: 'column' },
      h(Box, { paddingX: 1 }, h(Text, { bold: true }, 'New template')),
      h(Box, { height: 1 }),
      h(Box, { paddingX: 2 },
        h(Box, { width: 10 }, h(Text, { dimColor: true }, 'name')),
        h(Text, { color: field === 'name' ? 'yellow' : undefined },
          form.name + (field === 'name' ? '█' : ''),
        ),
      ),
      h(Box, { paddingX: 2 },
        h(Box, { width: 10 }, h(Text, { dimColor: true }, 'subject')),
        h(Text, { color: field === 'subject' ? 'yellow' : undefined },
          form.subject + (field === 'subject' ? '█' : ''),
        ),
      ),
      h(Box, { paddingX: 2 },
        h(Box, { width: 10 }, h(Text, { dimColor: true }, 'account')),
        h(Text, { color: field === 'from' ? 'yellow' : undefined },
          `← ${acc.key}  (${acc.from}) →`,
        ),
      ),
      h(Box, { paddingX: 2 },
        h(Box, { width: 10 }, h(Text, { dimColor: true }, 'format')),
        h(Text, { color: field === 'format' ? 'yellow' : undefined },
          markdown ? '← markdown →' : '← plain text →',
        ),
      ),
      h(Box, { height: 1 }),
      h(Box, { paddingX: 1 }, h(Text, { dimColor: true }, 'tab next  ↵ open editor  esc cancel')),
    );
  }

  if (mode === 'confirming-delete') {
    return h(Box, { flexDirection: 'column' },
      h(Box, { paddingX: 1 }, h(Text, { bold: true }, 'Templates')),
      h(Box, { height: 1 }),
      h(Box, { paddingX: 2 },
        h(Text, { color: 'red' }, `Delete "${selected}"? `),
        h(Text, {}, 'y / n'),
      ),
    );
  }

  return h(Box, { flexDirection: 'column' },
    h(Box, { paddingX: 1 },
      h(Text, { bold: true, color: 'cyan' }, 'Templates  '),
      h(Text, { dimColor: true }, `${templates.length} total`),
    ),
    h(Box, { flexDirection: 'column' },
      templates.length === 0
        ? h(Box, { paddingX: 2 }, h(Text, { dimColor: true }, 'no templates yet'))
        : templates.slice(0, listHeight).map((name, i) => {
            const active = i === cursor;
            let meta = '';
            try { meta = `  (${parseTemplate(name).from})`; } catch {}
            const mdTag = isMarkdownTemplate(name) ? '  [md]' : '';
            return h(Box, { key: name, paddingX: 1 },
              h(Text, { inverse: active }, `${active ? '▸' : ' '} ${name}${meta}${mdTag}`),
            );
          }),
    ),
    h(Box, { paddingX: 1, marginTop: 1 },
      h(Text, { dimColor: true }, 'n new  ↵/e edit  d delete  esc back'),
    ),
  );
}
