import { readFileSync } from 'fs';
import { getSheetValues, getAllSheets, appendRows } from './sheets.mjs';
import { loadConfig } from './profiles.mjs';

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
