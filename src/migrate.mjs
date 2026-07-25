#!/usr/bin/env node
import { loadProfiles } from './profiles.mjs';
import db, { getProfiles, addRelationship } from './db.mjs';

const existing = getProfiles();
if (existing.length > 0 && !process.argv.includes('--force')) {
  console.log(`DB already has ${existing.length} profiles. Pass --force to reimport.`);
  process.exit(0);
}

if (existing.length > 0) {
  db.exec('DELETE FROM profiles');
  console.log('Cleared existing profiles.');
}

process.stdout.write('Loading from Google Sheets... ');
const profiles = await loadProfiles();
console.log(`${profiles.length} profiles found.`);

const insertProfile = db.prepare('INSERT INTO profiles DEFAULT VALUES');
const insertAttr    = db.prepare(
  'INSERT INTO attributes (profile_id, type, data, sort_order) VALUES (?, ?, ?, ?)'
);

const relatedToEntries = [];
const withEntries      = [];

const run = db.transaction((ps) => {
  for (const p of ps) {
    const { lastInsertRowid: pid } = insertProfile.run();
    let order = 0;
    const add = (type, value) => insertAttr.run(pid, type, JSON.stringify(value), order++);

    if (p.firstName)       add('first_name',      p.firstName);
    if (p.lastName)        add('last_name',        p.lastName);
    if (p.group)           add('group',            p.group);
    if (p.dateAdded)       add('date_added',       p.dateAdded);
    if (p.connectionLevel) add('connection_level', p.connectionLevel);
    if (p.met)             add('met',              p.met);

    for (const e of p.emails)      add('email',      { address: e.address, label: e.label });
    for (const e of p.phones)      add('phone',      { number: e.number,  label: e.label });
    for (const e of p.websites)    add('website',    { url: e.url,        label: e.label });
    for (const e of p.socials)     add('social',     { url: e.url, label: e.label, status: e.status, lastChecked: e.lastChecked });
    for (const e of p.professions) add('profession', e.text);
    for (const e of p.companies)   add('company',    e.text);
    for (const e of p.podcasts)    add('podcast',    e.text);
    for (const e of p.interests)   add('interest',   e.text);
    for (const e of p.notes)       add('note',       e.text);
    for (const e of p.proposals)   add('proposal',   e.text);
    for (const e of p.promises)    add('promise',    e.text);
    for (const e of p.relatedTo)   relatedToEntries.push({ profileId: pid, text: e.text });
    for (const e of p.with)        withEntries.push({ profileId: pid, text: e.text });
    for (const e of p.messages)    add('message',    {
      text: e.text, dateSent: e.dateSent, status: e.status,
      channel: e.channel, templateName: e.templateName,
    });
    for (const c of p.cards)       add('card', c);
  }
});

run(profiles);
console.log(`Migrated ${profiles.length} profiles.`);

const findByName = db.prepare(`
  SELECT p.id
  FROM profiles p
  JOIN attributes a1 ON a1.profile_id = p.id AND a1.type = 'first_name'
  LEFT JOIN attributes a2 ON a2.profile_id = p.id AND a2.type = 'last_name'
  WHERE lower(trim(json_extract(a1.data, '$') || ' ' || COALESCE(json_extract(a2.data, '$'), ''))) = ?
  LIMIT 1
`);

let relMigrated = 0;
let relSkipped  = 0;
const insertAttrRel = db.prepare(
  'INSERT INTO attributes (profile_id, type, data, sort_order) VALUES (?, ?, ?, ?)'
);
const resolveAndInsert = db.transaction((entries, type) => {
  for (const { profileId, text } of entries) {
    const nameKey = text.trim().toLowerCase();
    if (!nameKey) { relSkipped++; continue; }
    const match = findByName.get(nameKey);
    if (match && match.id !== profileId) {
      addRelationship(profileId, match.id, type);
      relMigrated++;
    } else {
      // Keep as text attribute if no match found
      const maxOrder = db.prepare(
        'SELECT COALESCE(MAX(sort_order), 0) FROM attributes WHERE profile_id = ?'
      ).pluck().get(profileId);
      insertAttrRel.run(profileId, type, JSON.stringify(text), maxOrder + 1);
      relSkipped++;
    }
  }
});

resolveAndInsert(relatedToEntries, 'related_to');
resolveAndInsert(withEntries,      'with');

if (relMigrated || relSkipped) {
  console.log(`Relationships: ${relMigrated} linked, ${relSkipped} unmatched (stored as text).`);
}
