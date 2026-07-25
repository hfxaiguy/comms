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

  CREATE TABLE IF NOT EXISTS relationships (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    from_profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    to_profile_id   INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    type            TEXT NOT NULL DEFAULT 'related_to',
    created_at      TEXT DEFAULT (datetime('now')),
    UNIQUE(from_profile_id, to_profile_id, type)
  );
  CREATE INDEX IF NOT EXISTS idx_rel_from ON relationships(from_profile_id);
  CREATE INDEX IF NOT EXISTS idx_rel_to   ON relationships(to_profile_id);
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

export function getRelationships(profileId) {
  return db.prepare(`
    SELECT
      r.id,
      r.type,
      r.from_profile_id,
      r.to_profile_id,
      CASE
        WHEN r.from_profile_id = ? THEN r.to_profile_id
        ELSE r.from_profile_id
      END AS linked_profile_id,
      CASE
        WHEN r.from_profile_id = ? THEN
          COALESCE(
            (SELECT json_extract(a.data, '$') FROM attributes a WHERE a.profile_id = r.to_profile_id AND a.type = 'first_name'),
            ''
          ) || ' ' || COALESCE(
            (SELECT json_extract(a.data, '$') FROM attributes a WHERE a.profile_id = r.to_profile_id AND a.type = 'last_name'),
            ''
          )
        ELSE
          COALESCE(
            (SELECT json_extract(a.data, '$') FROM attributes a WHERE a.profile_id = r.from_profile_id AND a.type = 'first_name'),
            ''
          ) || ' ' || COALESCE(
            (SELECT json_extract(a.data, '$') FROM attributes a WHERE a.profile_id = r.from_profile_id AND a.type = 'last_name'),
            ''
          )
      END AS linked_name
    FROM relationships r
    WHERE r.from_profile_id = ? OR r.to_profile_id = ?
    ORDER BY linked_name
  `).all(profileId, profileId, profileId, profileId);
}

export function addRelationship(fromId, toId, type = 'related_to') {
  if (fromId === toId) throw new Error('Cannot create a relationship between a profile and itself');
  db.prepare(
    'INSERT OR IGNORE INTO relationships (from_profile_id, to_profile_id, type) VALUES (?, ?, ?)'
  ).run(fromId, toId, type);
}

export function deleteRelationship(id) {
  db.prepare('DELETE FROM relationships WHERE id = ?').run(id);
}

export function migrateTextRelationships() {
  const textRels = db.prepare(`
    SELECT a.id AS attr_id, a.profile_id, a.type, a.data
    FROM attributes a
    WHERE a.type IN ('related_to', 'with')
  `).all();

  const findByName = db.prepare(`
    SELECT p.id
    FROM profiles p
    JOIN attributes a1 ON a1.profile_id = p.id AND a1.type = 'first_name'
    LEFT JOIN attributes a2 ON a2.profile_id = p.id AND a2.type = 'last_name'
    WHERE lower(trim(json_extract(a1.data, '$') || ' ' || COALESCE(json_extract(a2.data, '$'), ''))) = ?
    LIMIT 1
  `);

  let migrated = 0;
  let unmatched = 0;

  const run = db.transaction(() => {
    for (const rel of textRels) {
      const text = JSON.parse(rel.data);
      if (typeof text !== 'string' || !text.trim()) {
        unmatched++;
        continue;
      }

      const nameKey = text.trim().toLowerCase();
      const match = findByName.get(nameKey);

      if (match && match.id !== rel.profile_id) {
        addRelationship(rel.profile_id, match.id, rel.type);
        deleteAttribute(rel.attr_id);
        migrated++;
      } else {
        unmatched++;
      }
    }
  });

  run();
  return { migrated, unmatched };
}

export function searchProfiles(query) {
  const q = `%${query}%`;
  return db.prepare(`
    SELECT DISTINCT
      p.id,
      MAX(CASE WHEN a.type = 'first_name' THEN json_extract(a.data, '$') END) AS first_name,
      MAX(CASE WHEN a.type = 'last_name'  THEN json_extract(a.data, '$') END) AS last_name,
      GROUP_CONCAT(CASE WHEN a.type = 'group' THEN json_extract(a.data, '$') END) AS group_name
    FROM profiles p
    JOIN attributes a ON a.profile_id = p.id
    WHERE json_extract(a.data, '$') LIKE ? ESCAPE '\\'
       OR (a.type = 'email' AND json_extract(a.data, '$.address') LIKE ? ESCAPE '\\')
       OR (a.type = 'phone' AND json_extract(a.data, '$.number') LIKE ? ESCAPE '\\')
       OR (a.type = 'website' AND json_extract(a.data, '$.url') LIKE ? ESCAPE '\\')
       OR (a.type = 'social' AND json_extract(a.data, '$.url') LIKE ? ESCAPE '\\')
    GROUP BY p.id
    ORDER BY first_name, last_name
  `).all(q, q, q, q, q);
}

export function findProfileByName(name) {
  const parts = name.trim().split(/\s+/);
  let query, params;
  if (parts.length >= 2) {
    query = `
      SELECT p.id
      FROM profiles p
      JOIN attributes a1 ON a1.profile_id = p.id AND a1.type = 'first_name'
      LEFT JOIN attributes a2 ON a2.profile_id = p.id AND a2.type = 'last_name'
      WHERE lower(json_extract(a1.data, '$')) = ?
        AND lower(COALESCE(json_extract(a2.data, '$'), '')) = ?
      LIMIT 1
    `;
    params = [parts[0].toLowerCase(), parts.slice(1).join(' ').toLowerCase()];
  } else {
    query = `
      SELECT p.id
      FROM profiles p
      JOIN attributes a1 ON a1.profile_id = p.id AND a1.type = 'first_name'
      WHERE lower(json_extract(a1.data, '$')) = ?
      LIMIT 1
    `;
    params = [parts[0].toLowerCase()];
  }
  return db.prepare(query).get(...params);
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
