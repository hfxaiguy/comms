import { readFileSync } from 'fs';
import { getSheetValues, getAllSheets, appendRows } from './sheets.mjs';
import { loadConfig } from './profiles.mjs';
import { getDb, createProfile, addAttribute } from './db.mjs';
const db = getDb();

/** Parses one CSV line into an array of field strings, handling quoted fields and escaped quotes. */
function parseRow(line) {
  const fields = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      let field = '';
      i++;
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') { field += '"'; i += 2; }
        else if (line[i] === '"') { i++; break; }
        else { field += line[i++]; }
      }
      fields.push(field);
      if (line[i] === ',') i++;
    } else {
      let field = '';
      while (i < line.length && line[i] !== ',') field += line[i++];
      fields.push(field);
      if (line[i] === ',') i++;
    }
  }
  return fields;
}

/** Parses CSV text (including BOM-prefixed files) into an array of header-keyed objects. */
function parseCsv(text) {
  const clean = text.startsWith('﻿') ? text.slice(1) : text;
  const lines = clean.split(/\r?\n/);
  const headers = parseRow(lines[0]);
  const records = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const vals = parseRow(lines[i]);
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = vals[idx] ?? ''; });
    records.push(obj);
  }
  return records;
}

/**
 * Returns the spreadsheet ID that contains a tab named `sheetName`.
 * Throws if no match is found or if multiple spreadsheets match.
 */
export async function findSpreadsheetForSheet(sheetName) {
  const { spreadsheets } = loadConfig();
  const matches = [];

  for (const { id } of spreadsheets) {
    const tabs = await getAllSheets(id);
    if (tabs.some(t => t.title === sheetName)) {
      matches.push(id);
    }
  }

  if (matches.length === 0) {
    throw new Error(`No configured spreadsheet has a tab named "${sheetName}".`);
  }
  if (matches.length > 1) {
    throw new Error(`Ambiguous: "${sheetName}" exists in ${matches.length} spreadsheets. Specify the spreadsheet ID explicitly.`);
  }

  return matches[0];
}

/**
 * Imports people from a CSV file into the sheet tab named `sheetName`.
 * Skips rows whose full name or email already exists in the sheet.
 * @returns {{ added: number, skipped: number }}
 */
export async function importCsv(csvPath, sheetName) {
  const spreadsheetId = await findSpreadsheetForSheet(sheetName);
  const records = parseCsv(readFileSync(csvPath, 'utf8'));

  const existingRows = await getSheetValues(spreadsheetId, `'${sheetName}'`);
  const existingNames  = new Set();
  const existingEmails = new Set();
  for (const row of existingRows) {
    const type = row[0]?.trim();
    if (type === 'Person') {
      existingNames.add(`${row[1]?.trim()} ${row[2]?.trim()}`.toLowerCase().trim());
    } else if (type === 'Email') {
      existingEmails.add(row[1]?.trim().toLowerCase());
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const toAppend = [];
  let added = 0;
  let skipped = 0;

  for (const r of records) {
    let firstName = r.first_name?.trim() ?? '';
    let lastName  = r.last_name?.trim()  ?? '';
    const email   = r.email?.trim()      ?? '';

    if (!firstName && !lastName) {
      const full = r.name?.trim() ?? '';
      if (!full) continue;
      const space = full.indexOf(' ');
      if (space === -1) { firstName = full; }
      else { firstName = full.slice(0, space); lastName = full.slice(space + 1); }
    }

    const fullNameKey = `${firstName} ${lastName}`.toLowerCase().trim();
    const emailKey    = email.toLowerCase();

    if (existingNames.has(fullNameKey) || (emailKey && existingEmails.has(emailKey))) {
      skipped++;
      continue;
    }

    existingNames.add(fullNameKey);
    if (emailKey) existingEmails.add(emailKey);

    toAppend.push(['Person', firstName, lastName, today]);
    if (email) toAppend.push(['Email', email]);
    added++;
  }

  if (toAppend.length) {
    await appendRows(spreadsheetId, sheetName, toAppend);
  }

  return { added, skipped };
}

// Column name aliases → canonical attribute type
const COL = {
  first_name:    'first_name',
  firstname:     'first_name',
  last_name:     'last_name',
  lastname:      'last_name',
  email:         'email',
  email_address: 'email',
  phone:         'phone',
  phone_number:  'phone',
  mobile:        'phone',
  company:       'company',
  organization:  'company',
  profession:    'profession',
  title:         'profession',
  job_title:     'profession',
  role:          'profession',
  group:         'group',
  note:          'note',
  notes:         'note',
  website:       'website',
  url:           'website',
  linkedin:      'social_linkedin',
  linkedin_url:  'social_linkedin',
};

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

/**
 * Imports a CSV file into the SQLite DB.
 * Supported columns: first_name, last_name, name/full_name, email, phone, company,
 *   profession/title/job_title/role, group, note/notes, website/url, linkedin/linkedin_url
 * Duplicates (matched by name or email) are not re-created; if a group is specified
 * and the existing profile doesn't already have it, the group is added to them.
 * @param {string} csvPath
 * @param {string} [forceGroup] - overrides the group column for every row
 * @returns {{ added: number, groupsAdded: number, skipped: number, unknown: string[] }}
 */
export function importCsvToDb(csvPath, forceGroup) {
  const records = parseCsv(readFileSync(csvPath, 'utf8'));
  if (!records.length) return { added: 0, groupsAdded: 0, skipped: 0, unknown: [] };

  const unknownCols = Object.keys(records[0])
    .filter(h => h && h !== 'name' && h !== 'full_name' && !COL[h.toLowerCase().replace(/\s+/g, '_')]);

  let added = 0;
  let groupsAdded = 0;
  let skipped = 0;

  const run = db.transaction(() => {
    for (const r of records) {
      // Normalise keys
      const row = {};
      for (const [k, v] of Object.entries(r)) {
        row[k.toLowerCase().replace(/\s+/g, '_')] = v?.trim() ?? '';
      }

      // Resolve name
      let first = row.first_name || row.firstname || '';
      let last  = row.last_name  || row.lastname  || '';
      if (!first && !last) {
        const full = row.name || row.full_name || '';
        if (!full) { skipped++; continue; }
        ({ first, last } = splitName(full));
      }

      const nameKey  = `${first} ${last}`.trim().toLowerCase();
      const emailVal = row.email || row.email_address || '';
      const emailKey = emailVal.toLowerCase();
      const group    = forceGroup || row.group || '';

      // Check for existing profile
      const existing =
        findProfileByName.get(nameKey) ??
        (emailKey ? findProfileByEmail.get(emailKey) : null);

      if (existing) {
        // Add group to the existing profile if it doesn't already have it
        if (group && !hasGroup.get(existing.id, group)) {
          addAttribute(existing.id, 'group', JSON.stringify(group));
          groupsAdded++;
        } else {
          skipped++;
        }
        continue;
      }

      // New profile
      const attrs = [];
      const add = (type, data) => attrs.push({ type, data: JSON.stringify(data) });

      if (first) add('first_name', first);
      if (last)  add('last_name',  last);
      if (group) add('group', group);

      if (emailVal)                           add('email',      { address: emailVal, label: '' });
      if (row.phone)                          add('phone',      { number: row.phone, label: '' });
      if (row.company || row.organization)    add('company',    row.company || row.organization);
      if (row.profession || row.title || row.job_title || row.role)
                                              add('profession', row.profession || row.title || row.job_title || row.role);
      if (row.website || row.url)             add('website',    { url: row.website || row.url, label: '' });
      if (row.linkedin || row.linkedin_url)   add('social',     { url: row.linkedin || row.linkedin_url, label: 'LinkedIn', status: '', lastChecked: '' });
      if (row.note || row.notes)              add('note',       row.note || row.notes);

      createProfile(attrs);
      added++;
    }
  });

  run();
  return { added, groupsAdded, skipped, unknown: unknownCols };
}
