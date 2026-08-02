#!/usr/bin/env node
import { readFileSync } from 'fs';
import { getDb, getGroups, createProfile } from './db.mjs';
const db = getDb();

const SOURCE = '/home/love/Documents/Code/web-auto/volta-results.json';
const GROUP  = 'Volta Builders';

const { scrapedProfiles } = JSON.parse(readFileSync(SOURCE, 'utf8'));

function splitName(fullName) {
  const i = fullName.indexOf(' ');
  if (i === -1) return { firstName: fullName, lastName: '' };
  return { firstName: fullName.slice(0, i), lastName: fullName.slice(i + 1) };
}

function buildAttrs(data) {
  const attrs = [];
  const add   = (type, value) => attrs.push({ type, data: JSON.stringify(value) });

  const { firstName, lastName } = splitName(data.fullName ?? '');
  if (firstName) add('first_name', firstName);
  if (lastName)  add('last_name',  lastName);

  add('group', GROUP);

  if (data.about?.trim())    add('note', data.about.trim());

  if (data.email?.trim())
    add('email', { address: data.email.trim(), label: '' });

  if (data.linkedIn?.trim())
    add('social', { url: data.linkedIn.trim(), label: 'LinkedIn', status: '', lastChecked: '' });

  if (data.website?.trim())
    add('website', { url: data.website.trim(), label: '' });

  if (data.location?.trim()) {
    const firstLine = data.location.split('\n')[0].trim();
    if (firstLine) add('note', `Location: ${firstLine}`);
  }

  for (const tool of (data.tools ?? []))
    if (tool?.trim()) add('interest', tool.trim());

  for (const project of (data.projects?.items ?? [])) {
    const title = project.title?.trim();
    const cat   = project.category?.trim();
    const desc  = project.descriptions?.[0]?.trim();
    if (!title) continue;
    const parts = [title, cat ? `[${cat}]` : '', desc ? `— ${desc}` : ''].filter(Boolean);
    add('note', `Project: ${parts.join(' ')}`);
  }

  return attrs;
}

// Check for existing Volta Builders profiles to avoid double-import
const existing = db.prepare(
  `SELECT COUNT(*) as n FROM attributes WHERE type = 'group' AND json_extract(data, '$') = ?`
).get(GROUP).n;

if (existing > 0 && !process.argv.includes('--force')) {
  console.log(`${existing} profiles already exist in "${GROUP}". Pass --force to reimport.`);
  process.exit(0);
}

if (existing > 0) {
  // Remove existing profiles in this group
  const ids = db.prepare(
    `SELECT DISTINCT profile_id FROM attributes WHERE type = 'group' AND json_extract(data, '$') = ?`
  ).all(GROUP).map(r => r.profile_id);
  const del = db.prepare('DELETE FROM profiles WHERE id = ?');
  db.transaction(() => ids.forEach(id => del.run(id)))();
  console.log(`Cleared ${ids.length} existing profiles.`);
}

let imported = 0;
let skipped  = 0;

const run = db.transaction(() => {
  for (const { data } of scrapedProfiles) {
    if (!data.fullName?.trim()) { skipped++; continue; }
    createProfile(buildAttrs(data));
    imported++;
  }
});

run();

console.log(`Imported ${imported} profiles into "${GROUP}".`);
if (skipped > 0) console.log(`Skipped ${skipped} (no name).`);
