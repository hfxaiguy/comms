import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import vm from 'vm';
import path from 'path';
import { fileURLToPath } from 'url';
import db, {
  getAttributes, addAttribute, updateAttribute, deleteAttribute,
  createProfile, getProfilesByGroup, getProfiles, getGroups,
} from './db.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const AUTOMATIONS_DIR = path.join(__dirname, '..', 'automations');

if (!existsSync(AUTOMATIONS_DIR)) mkdirSync(AUTOMATIONS_DIR, { recursive: true });

export function listAutomations() {
  return readdirSync(AUTOMATIONS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace(/\.json$/, ''))
    .sort();
}

export function automationPath(name) {
  return path.join(AUTOMATIONS_DIR, `${name}.json`);
}

export function loadAutomation(name) {
  return JSON.parse(readFileSync(automationPath(name), 'utf8'));
}

export function saveAutomation(name, automation) {
  writeFileSync(automationPath(name), JSON.stringify(automation, null, 2), 'utf8');
}

export function deleteAutomation(name) {
  unlinkSync(automationPath(name));
}

// ── Profile loading ────────────────────────────────────────────────────────────

function parseProfileRow(row, attrs) {
  const get = (type) => {
    const a = attrs.find(a => a.type === type);
    return a ? JSON.parse(a.data) : null;
  };
  return {
    id:        row.id,
    firstName: get('first_name'),
    lastName:  get('last_name'),
    group:     get('group'),
    attrs,
  };
}

export function loadProfilesForGroup(group) {
  if (group === 'all') {
    const rows = getProfiles();
    return rows.map(row => {
      const attrs = getAttributes(row.id);
      return parseProfileRow(row, attrs);
    });
  }
  const rows = getProfilesByGroup(group);
  return rows.map(({ id, attrs }) => parseProfileRow({ id }, attrs));
}

export { getGroups };

// ── VM runner ─────────────────────────────────────────────────────────────────

export async function runCode(code, profiles) {
  let collected = null;

  const context = vm.createContext({
    profiles,
    db,
    getAttributes,
    addAttribute,
    updateAttribute,
    deleteAttribute,
    createProfile,
    collect: (data) => { collected = data; },
    JSON,
    console,
    Promise,
    setTimeout,
    clearTimeout,
    Error,
    Array,
    Object,
    Math,
    Date,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
  });

  await vm.runInContext(`(async () => { ${code} })()`, context);
  return collected;
}
