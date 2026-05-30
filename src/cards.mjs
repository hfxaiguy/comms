import { readdirSync, statSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { extractCardInfo } from './vision.mjs';
import { loadProfiles } from './profiles.mjs';
import { findSpreadsheetForSheet } from './import.mjs';
import { appendRows } from './sheets.mjs';
import { arrowSelect } from './prompt.mjs';

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const CARDS_DIR    = path.join(__dirname, '..', 'business-cards');
const STATE_PATH   = path.join(__dirname, '..', '.business-card-state.json');
const IMAGE_EXTS   = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

// ─── State ────────────────────────────────────────────────────────────────

function loadState() {
  try { return JSON.parse(readFileSync(STATE_PATH, 'utf8')); }
  catch { return {}; }
}

function saveState(state) {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
}

// ─── Image discovery ──────────────────────────────────────────────────────

function findImages(dir) {
  if (!existsSync(dir)) return [];
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findImages(full));
    } else if (IMAGE_EXTS.has(path.extname(entry.name).toLowerCase())) {
      results.push(full);
    }
  }
  return results;
}

function relPath(abs) {
  return path.relative(path.join(__dirname, '..'), abs);
}

// ─── Profile matching ─────────────────────────────────────────────────────

function findExistingProfile(profiles, info) {
  const emailSet = new Set(info.emails.map(e => e.toLowerCase()));
  const fullName = `${info.firstName} ${info.lastName}`.toLowerCase().trim();

  return profiles.find(p => {
    if (p.emails.some(e => emailSet.has(e.address.toLowerCase()))) return true;
    const pName = `${p.firstName} ${p.lastName}`.toLowerCase().trim();
    return pName === fullName && fullName !== '';
  });
}

// ─── Sheet writing ────────────────────────────────────────────────────────

function buildNewRows(info, imagePath) {
  const today = new Date().toISOString().slice(0, 10);
  const rows  = [['Person', info.firstName, info.lastName, today]];
  rows.push(['Card', imagePath]);
  for (const e of info.emails)      rows.push(['Email',      e]);
  for (const p of info.phones)      rows.push(['Phone',      p]);
  for (const w of info.websites)    rows.push(['Website',    w]);
  for (const c of info.companies)   rows.push(['Company',    c]);
  for (const p of info.professions) rows.push(['Profession', p]);
  for (const n of info.notes)       if (n) rows.push(['Note', n]);
  return rows;
}

function buildUpdateRows(profile, info, imagePath) {
  const existingEmails = new Set(profile.emails.map(e => e.address.toLowerCase()));
  const existingPhones = new Set(profile.phones.map(p => p.number));
  const rows = [['Card', imagePath]];
  for (const e of info.emails)      if (!existingEmails.has(e.toLowerCase())) rows.push(['Email', e]);
  for (const p of info.phones)      if (!existingPhones.has(p))               rows.push(['Phone', p]);
  for (const w of info.websites)    rows.push(['Website',    w]);
  for (const c of info.companies)   rows.push(['Company',    c]);
  for (const p of info.professions) rows.push(['Profession', p]);
  for (const n of info.notes)       if (n) rows.push(['Note', n]);
  return rows;
}

// ─── Display ──────────────────────────────────────────────────────────────

function printInfo(info) {
  const name = [info.firstName, info.lastName].filter(Boolean).join(' ') || '(no name)';
  console.log(`\n  Name:        ${name}`);
  if (info.emails.length)      console.log(`  Email:       ${info.emails.join(', ')}`);
  if (info.phones.length)      console.log(`  Phone:       ${info.phones.join(', ')}`);
  if (info.websites.length)    console.log(`  Website:     ${info.websites.join(', ')}`);
  if (info.companies.length)   console.log(`  Company:     ${info.companies.join(', ')}`);
  if (info.professions.length) console.log(`  Profession:  ${info.professions.join(', ')}`);
  if (info.notes.length)       console.log(`  Notes:       ${info.notes.join('; ')}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────

export async function processCards({ reprocess = false } = {}) {
  const images = findImages(CARDS_DIR);
  if (!images.length) {
    console.log(`No images found under ${CARDS_DIR}`);
    return;
  }

  const state    = loadState();
  const profiles = await loadProfiles();
  const pending  = reprocess
    ? images
    : images.filter(img => {
        const entry = state[relPath(img)];
        return !entry || entry.action === 'error';
      });

  console.log(`Found ${images.length} image(s), ${pending.length} unprocessed.`);
  if (!pending.length) {
    console.log('All done. Run with --reprocess to re-scan everything.');
    return;
  }

  for (const imgPath of pending) {
    const rel   = relPath(imgPath);
    const group = path.basename(path.dirname(imgPath)); // folder name = group
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`Card:  ${rel}`);
    console.log(`Group: ${group}`);

    // Extract
    process.stdout.write('Extracting via Kimi... ');
    let info;
    try {
      info = await extractCardInfo(imgPath);
      console.log('done.');
    } catch (err) {
      console.log(`failed: ${err.message}`);
      state[rel] = { processedAt: new Date().toISOString(), action: 'error', error: err.message };
      saveState(state);
      continue;
    }

    printInfo(info);

    const existing = findExistingProfile(profiles, info);

    let action;
    while (true) {
      const options = existing
        ? [`Update existing: ${existing.firstName} ${existing.lastName}`, 'Create as new person', 'Open image', 'Skip']
        : ['Create new person', 'Open image', 'Skip'];

      const choice = await arrowSelect(options);
      const label  = options[choice];

      if (label === 'Open image') {
        spawnSync('xdg-open', [imgPath], { detached: true, stdio: 'ignore' });
        continue;
      }

      action = label.startsWith('Update') ? 'update'
             : label.startsWith('Create') ? 'create'
             : 'skip';
      break;
    }

    if (action === 'skip') {
      state[rel] = { processedAt: new Date().toISOString(), action: 'skipped' };
      saveState(state);
      continue;
    }

    // Resolve which spreadsheet/sheet to write to
    let spreadsheetId, sheetName;
    try {
      spreadsheetId = await findSpreadsheetForSheet(group);
      sheetName     = group;
    } catch {
      console.log(`  Group "${group}" not found in config — skipping. Add the sheet first with: comms add-sheet`);
      state[rel] = { processedAt: new Date().toISOString(), action: 'skipped', reason: 'unknown-group' };
      saveState(state);
      continue;
    }

    const personName = `${info.firstName} ${info.lastName}`.trim();

    if (action === 'create') {
      const rows = buildNewRows(info, rel);
      await appendRows(spreadsheetId, sheetName, rows);
      console.log(`  ✓ Created ${personName} in "${sheetName}".`);
      state[rel] = { processedAt: new Date().toISOString(), action: 'created', person: personName };
    } else {
      const rows = buildUpdateRows(existing, info, rel);
      if (rows.length) {
        await appendRows(spreadsheetId, existing._source.sheetName, rows);
        console.log(`  ✓ Added ${rows.length} new row(s) to ${existing.firstName} ${existing.lastName}.`);
      } else {
        console.log(`  No new information to add.`);
      }
      state[rel] = { processedAt: new Date().toISOString(), action: 'updated', person: personName };
    }

    saveState(state);
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log('Done.');
}
