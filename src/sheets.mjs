import { google } from 'googleapis';
import { getAuthClient } from './auth.mjs';

let _sheets = null;

async function getSheetsClient() {
  if (_sheets) return _sheets;
  const auth = await getAuthClient();
  _sheets = google.sheets({ version: 'v4', auth });
  return _sheets;
}

export async function getSheetValues(spreadsheetId, range) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  return res.data.values ?? [];
}

export async function getSheetMetadata(spreadsheetId) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.get({ spreadsheetId });
  return res.data;
}

export async function getAllSheetNames(spreadsheetId) {
  const metadata = await getSheetMetadata(spreadsheetId);
  return metadata.sheets.map(s => s.properties.title);
}

// Returns [{ title, sheetId }] for every tab in the spreadsheet.
export async function getAllSheets(spreadsheetId) {
  const metadata = await getSheetMetadata(spreadsheetId);
  return metadata.sheets.map(s => ({
    title:   s.properties.title,
    sheetId: s.properties.sheetId,
  }));
}

// Appends rows after the last non-empty row in the sheet.
export async function appendRows(spreadsheetId, sheetName, rows) {
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${sheetName}'!A1`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rows },
  });
}

// Inserts a new row immediately after `afterRowIndex` (0-based).
export async function insertRowAfter(spreadsheetId, sheetId, sheetName, afterRowIndex, values) {
  const sheets = await getSheetsClient();

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        insertDimension: {
          range: { sheetId, dimension: 'ROWS', startIndex: afterRowIndex + 1, endIndex: afterRowIndex + 2 },
          inheritFromBefore: true,
        },
      }],
    },
  });

  const rowNumber = afterRowIndex + 2; // 1-based, after the inserted row
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${sheetName}'!A${rowNumber}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [values] },
  });
}
