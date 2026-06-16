import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'fs';
import os from 'os';
import path from 'path';

const DATA_DIR = path.join(os.homedir(), '.comms');
const DB_PATH  = path.join(DATA_DIR, 'comms.db');

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS profiles (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS attributes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    type       TEXT NOT NULL,
    data       TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_attr_profile ON attributes(profile_id);
  CREATE INDEX IF NOT EXISTS idx_attr_type    ON attributes(type);
`);

export function getProfiles() {
  return db.prepare(`
    SELECT
      p.id,
      MAX(CASE WHEN a.type = 'first_name' THEN json_extract(a.data, '$') END) AS first_name,
      MAX(CASE WHEN a.type = 'last_name'  THEN json_extract(a.data, '$') END) AS last_name,
      GROUP_CONCAT(CASE WHEN a.type = 'group' THEN json_extract(a.data, '$') END) AS group_name
    FROM profiles p
    LEFT JOIN attributes a ON a.profile_id = p.id
    GROUP BY p.id
    ORDER BY first_name, last_name
  `).all();
}

export function getAttributes(profileId) {
  return db.prepare(`
    SELECT type, data, sort_order, id
    FROM attributes
    WHERE profile_id = ?
    ORDER BY sort_order, id
  `).all(profileId);
}

export function getProfilesByGroup(group) {
  const rows = db.prepare(`
    SELECT DISTINCT profile_id
    FROM attributes
    WHERE type = 'group' AND json_extract(data, '$') = ?
  `).all(group);
  return rows.map(r => ({ id: r.profile_id, attrs: getAttributes(r.profile_id) }));
}

export function getGroups() {
  return db.prepare(
    `SELECT DISTINCT json_extract(data, '$') AS name
     FROM attributes WHERE type = 'group' ORDER BY name`
  ).all().map(r => r.name).filter(Boolean);
}

export function createProfile(attrs) {
  const { lastInsertRowid: profileId } = db.prepare('INSERT INTO profiles DEFAULT VALUES').run();
  const stmt = db.prepare(
    'INSERT INTO attributes (profile_id, type, data, sort_order) VALUES (?, ?, ?, ?)'
  );
  db.transaction(() => {
    attrs.forEach(({ type, data }, i) => stmt.run(profileId, type, data, i));
  })();
  return profileId;
}

export function addAttribute(profileId, type, data) {
  const maxOrder = db.prepare(
    'SELECT COALESCE(MAX(sort_order), 0) FROM attributes WHERE profile_id = ?'
  ).pluck().get(profileId);
  db.prepare(
    'INSERT INTO attributes (profile_id, type, data, sort_order) VALUES (?, ?, ?, ?)'
  ).run(profileId, type, data, maxOrder + 1);
}

export function updateAttribute(id, data) {
  db.prepare('UPDATE attributes SET data = ? WHERE id = ?').run(data, id);
}

export function deleteAttribute(id) {
  db.prepare('DELETE FROM attributes WHERE id = ?').run(id);
}

export function deleteProfile(id) {
  db.prepare('DELETE FROM profiles WHERE id = ?').run(id);
}

export function logMessage(profileId, data) {
  const maxOrder = db.prepare(
    'SELECT COALESCE(MAX(sort_order), 0) FROM attributes WHERE profile_id = ?'
  ).pluck().get(profileId);
  db.prepare(
    'INSERT INTO attributes (profile_id, type, data, sort_order) VALUES (?, ?, ?, ?)'
  ).run(profileId, 'message', JSON.stringify(data), maxOrder + 1);
}

export default db;
