#!/usr/bin/env node
import { readFileSync } from 'fs';
import db, { createProfile, addAttribute } from './db.mjs';

// ── Field mapping ────────────────────────────────────────────────────────────

// Keys that map to simple string attribute types
const SIMPLE_MAP = {
  first_name: 'first_name', firstname: 'first_name',
  last_name: 'last_name', lastname: 'last_name',
  company: 'company', organization: 'company', businessname: 'company',
  profession: 'profession', title: 'profession', job_title: 'profession', role: 'profession', position: 'profession',
  group: 'group', category: 'interest',
  podcast: 'podcast', session: 'podcast',
  about: 'note', bio: 'note', description: 'note', pitch: 'note',
  interest: 'interest',
};

// Keys that map to structured attribute types (primary field for single values)
const STRUCTURED_MAP = {
  email:        { type: 'email',    primary: 'address' },
  phone:        { type: 'phone',    primary: 'number' },
  cell:         { type: 'phone',    primary: 'number', label: 'Cell' },
  fax:          { type: 'phone',    primary: 'number', label: 'Fax' },
  website:      { type: 'website',  primary: 'url' },
  url:          { type: 'website',  primary: 'url' },
  detailurl:    { type: 'website',  primary: 'url' },
  linkedin:     { type: 'social',   primary: 'url', label: 'LinkedIn' },
  linkedin_url: { type: 'social',   primary: 'url', label: 'LinkedIn' },
  location:     { type: 'location', primary: 'region' },
  address:      { type: 'location', primary: 'label' },
};

// Keys that are arrays of a type
const ARRAY_MAP = {
  websites:   { type: 'website',   primary: 'url' },
  notes:      { type: 'note' },
  interests:  { type: 'interest' },
  tools:      { type: 'interest' },
  categories: { type: 'interest' },
  socials:    { type: 'social',    detectPlatform: true },
  operatesIn: { type: 'location',  primary: 'region' },
  emails:     { type: 'email',     primary: 'address' },
  phones:     { type: 'phone',     primary: 'number' },
};

// Nested object keys to recurse into
const RECURSE_KEYS = new Set(['contact', 'data']);

// Fresh defaults for structured types
const FRESH_DEFAULTS = {
  email:    { address: '', label: '' },
  phone:    { number: '', label: '' },
  website:  { url: '', label: '' },
  social:   { url: '', label: '', status: '', lastChecked: '' },
  location: { city: '', region: '', country: '', label: '' },
};

// Platform name → social label mapping
const PLATFORM_LABELS = {
  linkedin: 'LinkedIn',
  'twitter/x': 'Twitter',
  twitter: 'Twitter',
  facebook: 'Facebook',
  instagram: 'Instagram',
  youtube: 'YouTube',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function splitName(full) {
  const i = full.indexOf(' ');
  if (i === -1) return { first: full, last: '' };
  return { first: full.slice(0, i), last: full.slice(i + 1) };
}

const findProfileByName = db.prepare(`
  SELECT p.id
  FROM profiles p
  JOIN attributes a1 ON a1.profile_id = p.id AND a1.type = 'first_name'
  LEFT JOIN attributes a2 ON a2.profile_id = p.id AND a2.type = 'last_name'
  WHERE lower(json_extract(a1.data, '$') || ' ' || COALESCE(json_extract(a2.data, '$'), '')) = ?
  LIMIT 1
`);

const findProfileByEmail = db.prepare(`
  SELECT profile_id AS id FROM attributes
  WHERE type = 'email' AND lower(json_extract(data, '$.address')) = ?
  LIMIT 1
`);

const hasGroup = db.prepare(`
  SELECT 1 FROM attributes
  WHERE profile_id = ? AND type = 'group' AND json_extract(data, '$') = ?
  LIMIT 1
`);

// ── Resolve array from JSON ──────────────────────────────────────────────────

function resolveArray(json, arrayPath) {
  if (Array.isArray(json)) return { entries: json, unknown: [] };

  if (arrayPath) {
    const val = json[arrayPath];
    if (!Array.isArray(val)) {
      console.error(`--array "${arrayPath}" is not an array (type: ${typeof val}).`);
      process.exit(1);
    }
    return { entries: val, unknown: [] };
  }

  // Auto-detect: find the first key whose value is an array
  for (const [k, v] of Object.entries(json)) {
    if (Array.isArray(v)) return { entries: v, unknown: [] };
  }

  console.error('Could not find an array in the JSON. Use --array <key> to specify.');
  process.exit(1);
}

// ── Parse --set flags ────────────────────────────────────────────────────────

function parseSetFlags(setFlags) {
  // Returns { simple: { type: value }, structured: { type: { field: value } } }
  const simple = {};
  const structured = {};

  for (const flag of setFlags) {
    const eqIdx = flag.indexOf('=');
    if (eqIdx === -1) {
      console.error(`Invalid --set format: "${flag}". Use --set type=value or --set type.field=value`);
      continue;
    }
    const key = flag.slice(0, eqIdx);
    const value = flag.slice(eqIdx + 1);
    const dotIdx = key.indexOf('.');

    if (dotIdx === -1) {
      // Simple: --set group="..."
      simple[key] = value;
    } else {
      // Structured: --set location.region="..."
      const type = key.slice(0, dotIdx);
      const field = key.slice(dotIdx + 1);
      if (!structured[type]) structured[type] = {};
      structured[type][field] = value;
    }
  }

  return { simple, structured };
}

// ── Build set attributes ─────────────────────────────────────────────────────

function buildSetAttrs({ simple, structured }) {
  const attrs = [];

  for (const [type, value] of Object.entries(simple)) {
    attrs.push({ type, data: JSON.stringify(value) });
  }

  for (const [type, fields] of Object.entries(structured)) {
    const defaults = FRESH_DEFAULTS[type];
    if (!defaults) {
      console.error(`Unknown structured type "${type}" in --set. Known: ${Object.keys(FRESH_DEFAULTS).join(', ')}`);
      continue;
    }
    const obj = { ...defaults, ...fields };
    attrs.push({ type, data: JSON.stringify(obj) });
  }

  return attrs;
}

// ── Auto-detect attributes from a JSON entry ─────────────────────────────────

function extractAttrs(entry) {
  const attrs = [];
  const add = (type, value) => attrs.push({ type, data: JSON.stringify(value) });
  const unknown = [];

  for (const [key, val] of Object.entries(entry)) {
    if (val == null || val === '') continue;
    const lk = key.toLowerCase().replace(/\s+/g, '_');

    // Name fields
    if (lk === 'name' || lk === 'full_name' || lk === 'fullname') {
      const nameStr = typeof val === 'string' ? val.trim() : '';
      if (nameStr) {
        const { first, last } = splitName(nameStr);
        if (first) add('first_name', first);
        if (last)  add('last_name', last);
      }
      continue;
    }

    // Simple string fields
    if (SIMPLE_MAP[lk]) {
      const v = typeof val === 'string' ? val.trim() : '';
      if (v) add(SIMPLE_MAP[lk], v);
      continue;
    }

    // Structured single fields
    if (STRUCTURED_MAP[lk]) {
      const def = STRUCTURED_MAP[lk];
      if (typeof val === 'string' && val.trim()) {
        const obj = { ...(FRESH_DEFAULTS[def.type] || {}), [def.primary]: val.trim() };
        if (def.label) obj.label = def.label;
        add(def.type, obj);
      } else if (typeof val === 'object' && val !== null) {
        // Already structured (e.g., { address: "...", label: "..." })
        add(def.type, val);
      }
      continue;
    }

    // Array fields
    if (ARRAY_MAP[lk] && Array.isArray(val)) {
      const def = ARRAY_MAP[lk];
      for (const item of val) {
        if (item == null || item === '') continue;

        if (def.detectPlatform && typeof item === 'object') {
          // socials[{platform, url}]
          const url = item.url?.trim() || item.href?.trim() || '';
          if (!url) continue;
          const platform = (item.platform || item.label || '').trim();
          const pl = platform.toLowerCase();

          if (pl === 'website') {
            add('website', { url, label: '' });
          } else {
            const label = PLATFORM_LABELS[pl] || platform || '';
            add('social', { url, label, status: '', lastChecked: '' });
          }
        } else if (typeof item === 'string' && item.trim()) {
          if (def.primary) {
            const obj = { ...(FRESH_DEFAULTS[def.type] || {}), [def.primary]: item.trim() };
            add(def.type, obj);
          } else {
            add(def.type, item.trim());
          }
        } else if (typeof item === 'object' && def.primary) {
          const primary = item[def.primary]?.trim?.() || '';
          if (primary) {
            const obj = { ...(FRESH_DEFAULTS[def.type] || {}), [def.primary]: primary };
            add(def.type, obj);
          }
        }
      }
      continue;
    }

    // interests.all[] nesting
    if (lk === 'interests' && typeof val === 'object' && !Array.isArray(val)) {
      const items = val.all || val.common || val.networkingAbout || [];
      for (const item of items) {
        if (typeof item === 'string' && item.trim()) add('interest', item.trim());
      }
      continue;
    }

    // services: comma-separated list → interest attributes
    if (lk === 'services' && typeof val === 'string' && val.trim()) {
      for (const svc of val.split(',').map(s => s.trim()).filter(Boolean)) {
        add('interest', svc);
      }
      continue;
    }

    // postalCode → location with label
    if (lk === 'postalcode' && typeof val === 'string' && val.trim()) {
      add('location', { city: '', region: '', country: '', label: val.trim() });
      continue;
    }

    // Nested objects to recurse into
    if (RECURSE_KEYS.has(lk) && typeof val === 'object' && !Array.isArray(val)) {
      const nested = extractAttrs(val);
      attrs.push(...nested.attrs);
      unknown.push(...nested.unknown);
      continue;
    }

    // Unknown key
    unknown.push(key);
  }

  return { attrs, unknown };
}

// ── Main import function ─────────────────────────────────────────────────────

export function importJsonToDb(jsonPath, { group, setFlags = [], arrayPath, dataPath, force = false } = {}) {
  let json;
  try {
    json = JSON.parse(readFileSync(jsonPath, 'utf8'));
  } catch (err) {
    console.error(`Failed to read JSON: ${err.message}`);
    process.exit(1);
  }

  // Resolve the array of entries
  const { entries, unknown: arrayUnknown } = resolveArray(json, arrayPath);

  // Unwrap --data path
  const unwrapped = dataPath
    ? entries.map(e => e[dataPath] ?? e)
    : entries;

  // Parse --set flags
  const parsedSets = parseSetFlags(setFlags);
  const setAttrs = buildSetAttrs(parsedSets);
  const setTypes = new Set([...Object.keys(parsedSets.simple), ...Object.keys(parsedSets.structured)]);
  if (group) setTypes.add('group'); // --group overrides JSON's own group field

  // Force: clear existing group
  if (force && group) {
    const ids = db.prepare(
      `SELECT DISTINCT profile_id FROM attributes WHERE type = 'group' AND json_extract(data, '$') = ?`
    ).all(group).map(r => r.profile_id);
    if (ids.length) {
      const del = db.prepare('DELETE FROM profiles WHERE id = ?');
      db.transaction(() => ids.forEach(id => del.run(id)))();
      console.log(`Cleared ${ids.length} existing profiles in "${group}".`);
    }
  } else if (force && !group) {
    console.error('--force requires --group to be specified.');
    process.exit(1);
  }

  let added = 0;
  let groupsAdded = 0;
  let skipped = 0;
  const allUnknown = new Set(arrayUnknown);

  const run = db.transaction(() => {
    for (const entry of unwrapped) {
      if (!entry || typeof entry !== 'object') { skipped++; continue; }

      // Auto-detect attributes from entry
      const { attrs: autoAttrs, unknown: entryUnknown } = extractAttrs(entry);
      for (const u of entryUnknown) allUnknown.add(u);

      // Extract name for dedup
      const firstNameAttr = autoAttrs.find(a => a.type === 'first_name');
      const lastNameAttr = autoAttrs.find(a => a.type === 'last_name');
      const firstName = firstNameAttr ? JSON.parse(firstNameAttr.data) : '';
      const lastName = lastNameAttr ? JSON.parse(lastNameAttr.data) : '';
      const nameKey = `${firstName} ${lastName}`.trim().toLowerCase();

      // Extract email for dedup
      const emailAttr = autoAttrs.find(a => a.type === 'email');
      const emailVal = emailAttr ? JSON.parse(emailAttr.data).address?.toLowerCase?.() || '' : '';

      // Resolve group
      const groupVal = group || '';

      // Check for existing profile
      const existing =
        (nameKey ? findProfileByName.get(nameKey) : null) ??
        (emailVal ? findProfileByEmail.get(emailVal) : null);

      if (existing) {
        // Duplicate: add group if needed
        if (groupVal && !hasGroup.get(existing.id, groupVal)) {
          addAttribute(existing.id, 'group', JSON.stringify(groupVal));
          groupsAdded++;
        } else {
          skipped++;
        }
        continue;
      }

      // Build final attribute list: auto-detected, minus types overridden by --set, then add --set
      const finalAttrs = [];

      // Add group
      if (groupVal) {
        finalAttrs.push({ type: 'group', data: JSON.stringify(groupVal) });
      }

      // Add auto-detected attributes (skip types overridden by --set)
      for (const attr of autoAttrs) {
        if (setTypes.has(attr.type)) continue; // --set overrides
        finalAttrs.push(attr);
      }

      // Add --set attributes
      finalAttrs.push(...setAttrs);

      // Need at least a name or company to create a profile
      const hasName = finalAttrs.some(a => a.type === 'first_name');
      const hasCompany = finalAttrs.some(a => a.type === 'company');
      if (!hasName && !hasCompany) { skipped++; continue; }

      // If no first_name but has company, use company as first_name
      if (!hasName && hasCompany) {
        const companyAttr = finalAttrs.find(a => a.type === 'company');
        finalAttrs.push({ type: 'first_name', data: companyAttr.data });
      }

      createProfile(finalAttrs);
      added++;
    }
  });

  run();

  return { added, groupsAdded, skipped, unknown: [...allUnknown] };
}
