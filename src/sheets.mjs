import { google } from 'googleapis';
import { getAuthClient } from './auth.mjs';

let _sheets = null;

/** Lazy singleton — reuses the authenticated Sheets client across calls. */
async function getSheetsClient() {
  if (_sheets) return _sheets;
  const auth = await getAuthClient();
  _sheets = google.sheets({ version: 'v4', auth });
  return _sheets;
}

/** Returns all cell values in `range` as a 2-D array of strings (empty array if blank). */
export async function getSheetValues(spreadsheetId, range) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  return res.data.values ?? [];
}

/** Returns the full spreadsheet metadata object from the Sheets API. */
export async function getSheetMetadata(spreadsheetId) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.get({ spreadsheetId });
  return res.data;
}

/** Returns the tab titles for every sheet in the spreadsheet. */
export async function getAllSheetNames(spreadsheetId) {
  const metadata = await getSheetMetadata(spreadsheetId);
  return metadata.sheets.map(s => s.properties.title);
}

/** Returns `[{ title, sheetId }]` for every tab in the spreadsheet. */
export async function getAllSheets(spreadsheetId) {
  const metadata = await getSheetMetadata(spreadsheetId);
  return metadata.sheets.map(s => ({
    title:   s.properties.title,
    sheetId: s.properties.sheetId,
  }));
}

/** Appends `rows` after the last non-empty row in the sheet. */
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

/** Updates a single cell. `rowIndex` and `colIndex` are 0-based. */
export async function setCell(spreadsheetId, sheetName, rowIndex, colIndex, value) {
  const sheets = await getSheetsClient();
  const col    = String.fromCharCode(65 + colIndex);
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range:             `'${sheetName}'!${col}${rowIndex + 1}`,
    valueInputOption:  'USER_ENTERED',
    requestBody:       { values: [[value]] },
  });
}

/** Updates a contiguous horizontal range of cells in one row. `rowIndex` and `startColIndex` are 0-based. */
export async function setCellRange(spreadsheetId, sheetName, rowIndex, startColIndex, values) {
  const sheets   = await getSheetsClient();
  const startCol = String.fromCharCode(65 + startColIndex);
  const endCol   = String.fromCharCode(65 + startColIndex + values.length - 1);
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range:            `'${sheetName}'!${startCol}${rowIndex + 1}:${endCol}${rowIndex + 1}`,
    valueInputOption: 'USER_ENTERED',
    requestBody:      { values: [values] },
  });
}

/** Inserts a blank row immediately after `afterRowIndex` (0-based) and writes `values` into it. */
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
