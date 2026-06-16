import React, { useState } from 'react';
import { Box, Text, useInput, useWindowSize } from 'ink';
import { listAgents, agentPath, writeAgentSkeleton, deleteAgent } from '../templates.mjs';

const h = React.createElement;

export default function AgentList({ onBack, onEdit }) {
  const { rows }           = useWindowSize();
  const [mode, setMode]    = useState('list'); // 'list' | 'creating' | 'confirming-delete'
  const [cursor, setCursor]  = useState(0);
  const [agents, setAgents]  = useState(() => listAgents());
  const [name, setName]      = useState('');

  const refresh  = () => setAgents(listAgents());
  const selected = agents[cursor];

  function submitCreate() {
    if (!name.trim()) return;
    writeAgentSkeleton(name.trim());
    onEdit(agentPath(name.trim()), 'agents');
  }

  useInput((input, key) => {
    if (mode === 'list') {
      if (key.escape || input === 'q') { onBack(); return; }
      if (key.upArrow)                 { setCursor(c => Math.max(0, c - 1)); return; }
      if (key.downArrow)               { setCursor(c => Math.min(agents.length - 1, c + 1)); return; }
      if (input === 'n')               { setName(''); setMode('creating'); return; }
      if (input === 'e' && selected)   { onEdit(agentPath(selected), 'agents'); return; }
      if (input === 'd' && selected)   { setMode('confirming-delete'); return; }
      if (key.return && selected)      { onEdit(agentPath(selected), 'agents'); return; }
      return;
    }

    if (mode === 'confirming-delete') {
      if (input === 'y') {
        deleteAgent(selected);
        refresh();
        setCursor(c => Math.min(c, agents.length - 2));
        setMode('list');
        return;
      }
      if (input === 'n' || key.escape) { setMode('list'); return; }
      return;
    }

    if (mode === 'creating') {
      if (key.escape)                      { setMode('list'); return; }
      if (key.return)                      { submitCreate(); return; }
      if (key.backspace || key.delete)     { setName(n => n.slice(0, -1)); return; }
      if (input && !key.ctrl && !key.meta) { setName(n => n + input); return; }
    }
  });

  const listHeight = Math.max(1, rows - 6);

  if (mode === 'creating') {
    return h(Box, { flexDirection: 'column' },
      h(Box, { paddingX: 1 }, h(Text, { bold: true }, 'New agent')),
      h(Box, { height: 1 }),
      h(Box, { paddingX: 2 },
        h(Box, { width: 10 }, h(Text, { dimColor: true }, 'name')),
        h(Text, { color: 'yellow' }, name + '█'),
      ),
      h(Box, { height: 1 }),
      h(Box, { paddingX: 1 }, h(Text, { dimColor: true }, '↵ open editor  esc cancel')),
    );
  }

  if (mode === 'confirming-delete') {
    return h(Box, { flexDirection: 'column' },
      h(Box, { paddingX: 1 }, h(Text, { bold: true }, 'Agents')),
      h(Box, { height: 1 }),
      h(Box, { paddingX: 2 },
        h(Text, { color: 'red' }, `Delete "${selected}"? `),
        h(Text, {}, 'y / n'),
      ),
    );
  }

  return h(Box, { flexDirection: 'column' },
    h(Box, { paddingX: 1 },
      h(Text, { bold: true, color: 'cyan' }, 'Agents  '),
      h(Text, { dimColor: true }, `${agents.length} total`),
    ),
    h(Box, { flexDirection: 'column' },
      agents.length === 0
        ? h(Box, { paddingX: 2 }, h(Text, { dimColor: true }, 'no agents yet — use {{ai:name}} in a template'))
        : agents.slice(0, listHeight).map((a, i) => {
            const active = i === cursor;
            return h(Box, { key: a, paddingX: 1 },
              h(Text, { inverse: active }, `${active ? '▸' : ' '} ${a}`),
            );
          }),
    ),
    h(Box, { paddingX: 1, marginTop: 1 },
      h(Text, { dimColor: true }, 'n new  ↵/e edit  d delete  esc back'),
    ),
  );
}
