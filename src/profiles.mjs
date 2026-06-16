import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getSheetValues, getAllSheets, insertRowAfter, appendRows, setCellRange } from './sheets.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '..', 'sheets.config.json');

/** Returns the parsed contents of sheets.config.json. */
export function loadConfig() {
  return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
}

/**
 * Loads every profile from all configured spreadsheets.
 * Each profile gets a `_source` property with `{ spreadsheetId, sheetName, sheetId }`.
 */
export async function loadProfiles() {
  const { spreadsheets } = loadConfig();
  const all = [];

  for (const { id: spreadsheetId } of spreadsheets) {
    const tabs = await getAllSheets(spreadsheetId);

    for (const { title: sheetName, sheetId } of tabs) {
      const rows = await getSheetValues(spreadsheetId, `'${sheetName}'`);
      const profiles = parseProfiles(rows, sheetName);
      for (const p of profiles) {
        p._source = { spreadsheetId, sheetName, sheetId };
      }
      all.push(...profiles);
    }
  }

  return all;
}

/**
 * Converts raw sheet rows into profile objects.
 * Each `Person` row starts a new profile; subsequent typed rows append to it.
 * @param {string[][]} rows - 2-D array of cell values from the sheet
 * @param {string} group - sheet tab name, used as the profile group
 */
export function parseProfiles(rows, group = '') {
  const profiles = [];
  let current = null;

  for (const row of rows) {
    const type = row[0]?.trim();
    if (!type) continue;

    switch (type) {
      case 'Person': {
        current = {
          group,
          firstName:       row[1]?.trim() ?? '',
          lastName:        row[2]?.trim() ?? '',
          dateAdded:       row[3]?.trim() ?? '',
          emails:          [],
          phones:          [],
          websites:        [],
          socials:         [],
          cards:           [],
          interests:       [],
          notes:           [],
          proposals:       [],
          promises:        [],
          messages:        [],
          professions:     [],
          companies:       [],
          podcasts:        [],
          connectionLevel: '',
          met:             '',
          relatedTo:       [],
          with:            [],
        };
        profiles.push(current);
        break;
      }

      case 'Interest':
        if (current) current.interests.push({ text: row[1]?.trim() ?? '' });
        break;

      case 'Note':
        if (current) current.notes.push({ text: row[1]?.trim() ?? '' });
        break;

      case 'Propose':
        if (current) current.proposals.push({ text: row[1]?.trim() ?? '' });
        break;

      case 'Message':
        if (current) current.messages.push({
          text:         row[1]?.trim() ?? '',
          dateSent:     row[2]?.trim() ?? '',
          status:       row[3]?.trim() ?? '',
          channel:      row[4]?.trim() ?? '',
          templateName: row[5]?.trim() ?? '',
        });
        break;

      case 'Card':
        if (current) current.cards.push(row[1]?.trim() ?? '');
        break;

      case 'Email':
        if (current) current.emails.push({
          address: row[1]?.trim() ?? '',
          label:   row[2]?.trim() ?? '',
        });
        break;

      case 'Phone':
        if (current) current.phones.push({
          number: row[1]?.trim() ?? '',
          label:  row[2]?.trim() ?? '',
        });
        break;

      case 'Website':
        if (current) current.websites.push({
          url:   row[1]?.trim() ?? '',
          label: row[2]?.trim() ?? '',
        });
        break;

      case 'Social':
        if (current) current.socials.push({
          url:         row[1]?.trim() ?? '',
          label:       row[2]?.trim() ?? '',
          status:      row[3]?.trim() ?? '',  // connected | not connected | pending | unknown
          lastChecked: row[4]?.trim() ?? '',  // ISO date of last LinkedIn status check
        });
        break;

      case 'Profession':
        if (current) current.professions.push({ text: row[1]?.trim() ?? '' });
        break;

      case 'Company':
        if (current) current.companies.push({ text: row[1]?.trim() ?? '' });
        break;

      case 'Podcast':
        if (current) current.podcasts.push({ text: row[1]?.trim() ?? '' });
        break;

      case 'Promise':
        if (current) current.promises.push({ text: row[1]?.trim() ?? '' });
        break;

      case 'Connection Level':
        if (current) current.connectionLevel = row[1]?.trim() ?? '';
        break;

      case 'Met':
        if (current) current.met = row[1]?.trim() ?? '';
        break;

      case 'Related to':
        if (current) current.relatedTo.push({ text: row[1]?.trim() ?? '' });
        break;

      case 'With':
        if (current) current.with.push({ text: row[1]?.trim() ?? '' });
        break;
    }
  }

  return profiles;
}

/**
 * Appends a new person and their field rows to the sheet tab matching `group`.
 * @param {string} group - sheet tab name to append to
 * @param {object} fields - structured person data (firstName, lastName, emails, etc.)
 */
export async function appendPerson(group, fields) {
  const { spreadsheets } = loadConfig();

  for (const { id: spreadsheetId } of spreadsheets) {
    const tabs = await getAllSheets(spreadsheetId);
    const tab  = tabs.find(t => t.title === group);
    if (!tab) continue;

    const date = new Date().toISOString().slice(0, 10);
    const rows = [
      ['Person', fields.firstName ?? '', fields.lastName ?? '', date],
      ...(fields.emails      ?? []).map(e => ['Email',      e.address, e.label ?? '']),
      ...(fields.phones      ?? []).map(p => ['Phone',      p.number,  p.label ?? '']),
      ...(fields.websites    ?? []).map(w => ['Website',    w.url,     w.label ?? '']),
      ...(fields.socials     ?? []).map(s => ['Social',     s.url,     s.label ?? '']),
      ...(fields.professions ?? []).map(p => ['Profession', p]),
      ...(fields.companies   ?? []).map(c => ['Company',    c]),
      ...(fields.interests   ?? []).map(i => ['Interest',   i]),
      ...(fields.notes       ?? []).map(n => ['Note',       n]),
    ];

    await appendRows(spreadsheetId, tab.title, rows);
    return;
  }

  throw new Error(`No sheet tab found for group "${group}"`);
}

/**
 * Writes the LinkedIn connection `status` and today's date into columns D–E
 * of the Social (or Website) row that contains `linkedinUrl`.
 */
export async function updateSocialStatus(profile, linkedinUrl, status) {
  const { spreadsheetId, sheetName } = profile._source;
  const rows = await getSheetValues(spreadsheetId, `'${sheetName}'`);

  const rowIndex = rows.findIndex(row =>
    (row[0]?.trim() === 'Social' || row[0]?.trim() === 'Website') &&
    row[1]?.trim() === linkedinUrl
  );

  if (rowIndex === -1) throw new Error(`LinkedIn row not found for "${profile.firstName}"`);

  const date = new Date().toISOString().slice(0, 10);
  await setCellRange(spreadsheetId, sheetName, rowIndex, 3, [status, date]);
}

/**
 * Inserts a `Social` row for `url` at the end of `firstName`'s section.
 * Matches by first name only — assumes uniqueness within the sheet.
 */
export async function saveWebsite(firstName, url, label = '') {
  const profiles = await loadProfiles();
  const nameLower = firstName.trim().toLowerCase();
  const profile = profiles.find(p => p.firstName.toLowerCase() === nameLower);

  if (!profile) throw new Error(`No person found with first name "${firstName}"`);

  const { spreadsheetId, sheetName, sheetId } = profile._source;
  const rows = await getSheetValues(spreadsheetId, `'${sheetName}'`);

  let personStart = -1;
  let sectionEnd  = -1;

  for (let i = 0; i < rows.length; i++) {
    const type = rows[i][0]?.trim();
    if (type === 'Person') {
      if (personStart !== -1) { sectionEnd = i - 1; break; }
      if (rows[i][1]?.trim().toLowerCase() === nameLower) personStart = i;
    }
  }

  if (personStart === -1) throw new Error(`Person "${firstName}" not found in sheet "${sheetName}"`);

  if (sectionEnd === -1) {
    sectionEnd = rows.length - 1;
    while (sectionEnd > personStart && !rows[sectionEnd]?.some(c => c?.trim())) sectionEnd--;
  }

  await insertRowAfter(spreadsheetId, sheetId, sheetName, sectionEnd, ['Social', url, label]);
}

/**
 * Inserts a `Message` row at the end of `firstName`'s section.
 * Matches by first name only — assumes uniqueness within the sheet.
 */
export async function logMessage(firstName, text, channel, status = 'sent', templateName = '') {
  const profiles = await loadProfiles();

  const nameLower = firstName.trim().toLowerCase();
  const profile = profiles.find(p => p.firstName.toLowerCase() === nameLower);

  if (!profile) {
    throw new Error(`No person found with first name "${firstName}"`);
  }

  const { spreadsheetId, sheetName, sheetId } = profile._source;
  const rows = await getSheetValues(spreadsheetId, `'${sheetName}'`);

  let personStart = -1;
  let sectionEnd  = -1;

  for (let i = 0; i < rows.length; i++) {
    const type = rows[i][0]?.trim();
    if (type === 'Person') {
      if (personStart !== -1) {
        sectionEnd = i - 1;
        break;
      }
      if (rows[i][1]?.trim().toLowerCase() === nameLower) {
        personStart = i;
      }
    }
  }

  if (personStart === -1) {
    throw new Error(`Person "${firstName}" not found in sheet "${sheetName}"`);
  }

  if (sectionEnd === -1) {
    sectionEnd = rows.length - 1;
    while (sectionEnd > personStart && !rows[sectionEnd]?.some(c => c?.trim())) {
      sectionEnd--;
    }
  }

  const date = new Date().toISOString().slice(0, 10);
  await insertRowAfter(spreadsheetId, sheetId, sheetName, sectionEnd, ['Message', text, date, status, channel, templateName]);
}
