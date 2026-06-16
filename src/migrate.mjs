#!/usr/bin/env node
import { loadProfiles } from './profiles.mjs';
import db, { getProfiles } from './db.mjs';

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
    for (const e of p.relatedTo)   add('related_to', e.text);
    for (const e of p.with)        add('with',       e.text);
    for (const e of p.messages)    add('message',    {
      text: e.text, dateSent: e.dateSent, status: e.status,
      channel: e.channel, templateName: e.templateName,
    });
    for (const c of p.cards)       add('card', c);
  }
});

run(profiles);
console.log(`Migrated ${profiles.length} profiles.`);
