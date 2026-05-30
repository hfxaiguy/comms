import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getSheetValues, getAllSheets, insertRowAfter } from './sheets.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '..', 'sheets.config.json');

export function loadConfig() {
  return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
}

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

export async function logMessage(firstName, text, channel, status = 'sent', templateName = '') {
  const profiles = await loadProfiles();

  const nameLower = firstName.trim().toLowerCase();
  const profile = profiles.find(p => p.firstName.toLowerCase() === nameLower);

  if (!profile) {
    throw new Error(`No person found with first name "${firstName}"`);
  }

  const { spreadsheetId, sheetName, sheetId } = profile._source;
  const rows = await getSheetValues(spreadsheetId, `'${sheetName}'`);

  // Find last row index belonging to this person within their sheet
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
