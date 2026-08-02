#!/usr/bin/env node
import { readFileSync } from 'fs';
import { getDb, createProfile } from './db.mjs';
const db = getDb();

const SOURCE = '/home/love/Documents/Code/web-auto/podcast-show-speaker-results-2.json';
const GROUP  = 'Speakers - Podcast Show';

const raw = JSON.parse(readFileSync(SOURCE, 'utf8'));
const results = Array.isArray(raw) ? raw : raw.results;

function splitName(fullName) {
  const i = fullName.indexOf(' ');
  if (i === -1) return { firstName: fullName, lastName: '' };
  return { firstName: fullName.slice(0, i), lastName: fullName.slice(i + 1) };
}

function buildAttrs(entry) {
  const attrs = [];
  const add = (type, value) => attrs.push({ type, data: JSON.stringify(value) });

  const { firstName, lastName } = splitName(entry.name.trim());
  if (firstName) add('first_name', firstName);
  if (lastName)  add('last_name',  lastName);

  add('group', GROUP);

  if (entry.company?.trim()) add('company', entry.company.trim());
  if (entry.title?.trim())   add('profession', entry.title.trim());

  for (const session of (entry.sessions ?? [])) {
    if (session.title?.trim()) add('podcast', session.title.trim());
  }

  return attrs;
}

const existing = db.prepare(
  `SELECT COUNT(*) as n FROM attributes WHERE type = 'group' AND json_extract(data, '$') = ?`
).get(GROUP).n;

if (existing > 0 && !process.argv.includes('--force')) {
  console.log(`${existing} profiles already exist in "${GROUP}". Pass --force to reimport.`);
  process.exit(0);
}

if (existing > 0) {
  const ids = db.prepare(
    `SELECT DISTINCT profile_id FROM attributes WHERE type = 'group' AND json_extract(data, '$') = ?`
  ).all(GROUP).map(r => r.profile_id);
  db.transaction(() => {
    const del = db.prepare('DELETE FROM profiles WHERE id = ?');
    ids.forEach(id => del.run(id));
  })();
  console.log(`Cleared ${ids.length} existing profiles.`);
}

let imported = 0;
let skipped  = 0;

db.transaction(() => {
  for (const entry of results) {
    if (!entry.name?.trim()) { skipped++; continue; }
    createProfile(buildAttrs(entry));
    imported++;
  }
})();

console.log(`Imported ${imported} profiles into "${GROUP}".`);
if (skipped > 0) console.log(`Skipped ${skipped} (no name).`);
