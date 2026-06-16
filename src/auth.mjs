import { google } from 'googleapis';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KEY_PATH = path.join(__dirname, '..', 'service-account.json');

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

/** Returns a GoogleAuth client scoped to Sheets, using service-account.json credentials. */
export function getAuthClient() {
  if (!existsSync(KEY_PATH)) {
    throw new Error(
      `Missing service-account.json. Download it from Google Cloud Console → IAM & Admin → Service Accounts → your account → Keys → Add Key → JSON, then place it at:\n  ${KEY_PATH}`
    );
  }

  const key = JSON.parse(readFileSync(KEY_PATH, 'utf8'));

  return new google.auth.GoogleAuth({
    credentials: key,
    scopes: SCOPES,
  });
}
