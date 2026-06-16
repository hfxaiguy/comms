import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import { marked } from 'marked';
import { callAgent } from './ai.mjs';

const __dirname          = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR      = path.join(os.homedir(), '.comms', 'templates');
const AGENTS_DIR         = path.join(os.homedir(), '.comms', 'agents');
const EMAIL_CONFIG_PATH  = path.join(__dirname, '..', 'email.config.json');

for (const dir of [TEMPLATES_DIR, AGENTS_DIR]) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// ── File I/O ──────────────────────────────────────────────────────────────────

export const agentPath = (name) => path.join(AGENTS_DIR, `${name}.txt`);

export function templatePath(name) {
  const md  = path.join(TEMPLATES_DIR, `${name}.md`);
  const txt = path.join(TEMPLATES_DIR, `${name}.txt`);
  return existsSync(md) ? md : txt;
}

export function isMarkdownTemplate(name) {
  return existsSync(path.join(TEMPLATES_DIR, `${name}.md`));
}

export function listTemplates() {
  return readdirSync(TEMPLATES_DIR)
    .filter(f => f.endsWith('.txt') || f.endsWith('.md'))
    .map(f => f.replace(/\.(txt|md)$/, ''))
    .filter((name, i, arr) => arr.indexOf(name) === i); // dedupe
}

export function listAgents() {
  return readdirSync(AGENTS_DIR).filter(f => f.endsWith('.txt')).map(f => f.slice(0, -4));
}

export function parseTemplate(name) {
  const src   = readFileSync(templatePath(name), 'utf8');
  const match = src.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/s);
  if (!match) return { subject: '', from: 'default', body: src };
  const meta  = Object.fromEntries(
    match[1].split('\n').filter(Boolean).map(l => {
      const i = l.indexOf(':');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
  );
  return { subject: meta.subject ?? '', from: meta.from ?? 'default', body: match[2] };
}

export function getAgentPrompt(name) {
  return readFileSync(agentPath(name), 'utf8').trim();
}

export function writeTemplateSkeleton(name, subject, from, markdown = false) {
  const ext     = markdown ? 'md' : 'txt';
  const file    = path.join(TEMPLATES_DIR, `${name}.${ext}`);
  const content = `---\nsubject: ${subject}\nfrom: ${from}\n---\nHi {{first_name}},\n\n\n\nBest,\n`;
  writeFileSync(file, content);
}

export function markdownToHtml(md) {
  return marked.parse(md, { async: false });
}

export function writeAgentSkeleton(name) {
  writeFileSync(agentPath(name), `Write one sentence for {{first_name}}, a {{profession}} at {{company}}.\n`);
}

export function deleteTemplate(name) { unlinkSync(templatePath(name)); }
export function deleteAgent(name)    { unlinkSync(agentPath(name)); }

// ── Email account lookup ──────────────────────────────────────────────────────

export function listEmailAccounts() {
  try {
    const config = JSON.parse(readFileSync(EMAIL_CONFIG_PATH, 'utf8'));
    const out    = [{ key: 'default', from: config.default?.from ?? 'default' }];
    for (const [k, v] of Object.entries(config.groups ?? {})) out.push({ key: k, from: v.from ?? k });
    return out;
  } catch {
    return [{ key: 'default', from: 'default' }];
  }
}

export function getEmailAccount(key) {
  try {
    const config = JSON.parse(readFileSync(EMAIL_CONFIG_PATH, 'utf8'));
    if (!key || key === 'default') return config.default;
    return config.groups?.[key] ?? config.default;
  } catch {
    return null;
  }
}

// ── Variable resolution ───────────────────────────────────────────────────────

function parseParams(str) {
  const params = {};
  for (const pair of (str ?? '').trim().split(/\s+/).filter(Boolean)) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    const k = pair.slice(0, eq);
    const v = pair.slice(eq + 1);
    params[k] = isNaN(v) ? v : Number(v);
  }
  return params;
}

// Returns [{ name, max? }] — one entry per unique agent name.
export function extractAiVars(template) {
  const text  = `${template.subject}\n${template.body}`;
  const seen  = new Map();
  for (const m of text.matchAll(/\{\{ai:([^}\s]+)([^}]*)?\}\}/g)) {
    const name = m[1];
    if (!seen.has(name)) seen.set(name, parseParams(m[2]));
  }
  return [...seen.entries()].map(([name, params]) => ({ name, ...params }));
}

export function buildProfileVars(attrs) {
  const byType = {};
  for (const a of attrs) {
    if (!byType[a.type]) byType[a.type] = [];
    byType[a.type].push(JSON.parse(a.data));
  }
  const first = (type) => byType[type]?.[0];
  return {
    first_name: first('first_name') ?? '',
    last_name:  first('last_name')  ?? '',
    company:    first('company')    ?? '',
    profession: first('profession') ?? '',
    group:      first('group')      ?? '',
    email:      first('email')?.address ?? '',
    phone:      first('phone')?.number  ?? '',
    note:       first('note')           ?? '',
    interest:   first('interest')       ?? '',
  };
}

export function buildProfileDump(attrs) {
  const lines = ['Profile:'];
  const fn    = attrs.find(a => a.type === 'first_name');
  const ln    = attrs.find(a => a.type === 'last_name');
  if (fn || ln) {
    lines.push(`name: ${[fn && JSON.parse(fn.data), ln && JSON.parse(ln.data)].filter(Boolean).join(' ')}`);
  }

  const fmt = (type, v) => {
    if (typeof v === 'string') return v;
    switch (type) {
      case 'email':   return [v.address, v.label].filter(Boolean).join(' ');
      case 'phone':   return [v.number,  v.label].filter(Boolean).join(' ');
      case 'website': return [v.url,     v.label].filter(Boolean).join(' ');
      case 'social':  return [v.url, v.label, v.status ? `[${v.status}]` : ''].filter(Boolean).join(' ');
      case 'message': return [v.channel, v.dateSent, v.text].filter(Boolean).join(' - ');
      default:        return JSON.stringify(v);
    }
  };

  const skip = new Set(['first_name', 'last_name']);
  for (const a of attrs) {
    if (skip.has(a.type)) continue;
    const display = fmt(a.type, JSON.parse(a.data));
    if (display) lines.push(`${a.type}: ${display}`);
  }

  return lines.join('\n');
}

export function resolveAll(text, vars) {
  return text.replace(/\{\{([^}]+)\}\}/g, (match, raw) => {
    // Strip params from ai vars: "ai:opener max=500" → "ai:opener"
    const key = raw.startsWith('ai:') ? raw.trim().split(/\s+/)[0] : raw.trim();
    return vars[key] ?? match;
  });
}

// ── AI generation ─────────────────────────────────────────────────────────────

export async function generateAiVars(template, attrs, onProgress) {
  const profileVars = buildProfileVars(attrs);
  const profileDump = buildProfileDump(attrs);
  const aiVars      = extractAiVars(template); // [{ name, max? }]
  const resolved    = {};

  for (const { name, max } of aiVars) {
    onProgress({ name, status: 'generating' });
    try {
      const raw        = getAgentPrompt(name);
      const prompt     = resolveAll(raw, profileVars);
      const fullPrompt = `${profileDump}\n\nTask:\n${prompt}`;
      resolved[name]   = await callAgent(fullPrompt, { max });
      onProgress({ name, status: 'done', value: resolved[name] });
    } catch (err) {
      onProgress({ name, status: 'error', error: err.message });
      resolved[name] = `[error: ${err.message}]`;
    }
  }

  return resolved;
}
