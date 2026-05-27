#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadProfiles, logMessage } from './src/profiles.mjs';
import { importCsv } from './src/import.mjs';
import { sendEmail, sendBlast, listTemplates } from './src/email.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, 'sheets.config.json');

function parseSpreadsheetId(input) {
  const urlMatch = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (urlMatch) return urlMatch[1];
  if (/^[a-zA-Z0-9_-]{20,}$/.test(input)) return input;
  return null;
}

function printProfiles(profiles) {
  for (const p of profiles) {
    const name  = [p.firstName, p.lastName].filter(Boolean).join(' ');
    const group = p.group ? `  [${p.group}]` : '';
    const since = p.dateAdded ? `  added ${p.dateAdded}` : '';
    console.log(`\n── ${name}${group}${since}`);

    if (p.emails.length)
      p.emails.forEach(e => console.log(`   email      ${e.address}${e.label ? ` (${e.label})` : ''}`));

    if (p.interests.length)
      p.interests.forEach(i => console.log(`   interest   ${i.text}`));

    if (p.proposals.length)
      p.proposals.forEach(i => console.log(`   propose    ${i.text}`));

    if (p.notes.length)
      p.notes.forEach(n => console.log(`   note       ${n.text}`));

    if (p.messages.length)
      p.messages.forEach(m => {
        const meta = [m.dateSent, m.status, m.channel].filter(Boolean).join(' · ');
        console.log(`   message    ${m.text || '(empty)'}${meta ? `  [${meta}]` : ''}`);
      });
  }
  console.log();
}

const [,, command, ...args] = process.argv;

switch (command) {
  case 'profiles': {
    const profiles = await loadProfiles();
    printProfiles(profiles);
    break;
  }

  // Internal: used by fish tab completion
  case '_names': {
    const profiles = await loadProfiles();
    profiles.forEach(p => {
      const full = [p.firstName, p.lastName].filter(Boolean).join(' ');
      console.log(`${p.firstName}\t${full}`);
    });
    break;
  }

  case '_templates': {
    listTemplates().forEach(t => console.log(t));
    break;
  }

  case '_groups': {
    const profiles = await loadProfiles();
    const seen = new Set();
    for (const p of profiles) {
      if (p.group && !seen.has(p.group)) { seen.add(p.group); console.log(p.group); }
    }
    break;
  }

  case 'log-whatsapp': {
    const [name, ...words] = args;
    if (!name || !words.length) {
      console.error('Usage: comms log-whatsapp <first-name> <message text>');
      process.exit(1);
    }
    await logMessage(name, words.join(' '), 'WhatsApp');
    console.log(`Logged WhatsApp message for ${name}.`);
    break;
  }

  case 'send-blast': {
    const [groupName, template] = args;
    if (!groupName || !template) {
      console.error('Usage: comms send-blast <group-name> <template-name>');
      process.exit(1);
    }
    await sendBlast(groupName, template);
    break;
  }

  case 'send-email': {
    const [name, template] = args;
    if (!name || !template) {
      console.error('Usage: comms send-email <first-name> <template-name>');
      process.exit(1);
    }
    await sendEmail(name, template);
    break;
  }

  case 'log-email': {
    const [name, ...words] = args;
    if (!name || !words.length) {
      console.error('Usage: comms log-email <first-name> <subject or description>');
      process.exit(1);
    }
    await logMessage(name, words.join(' '), 'Email');
    console.log(`Logged email for ${name}.`);
    break;
  }

  case 'import-csv': {
    const [csvPath, sheetName] = args;
    if (!csvPath || !sheetName) {
      console.error('Usage: comms import-csv <file.csv> <sheet-name>');
      process.exit(1);
    }
    const { added, skipped } = await importCsv(csvPath, sheetName);
    console.log(`Imported ${added} people to "${sheetName}" (${skipped} duplicates skipped).`);
    break;
  }

  case 'add-sheet': {
    const [input] = args;
    if (!input) {
      console.error('Usage: comms add-sheet <spreadsheet-url-or-id>');
      process.exit(1);
    }
    const id = parseSpreadsheetId(input);
    if (!id) {
      console.error(`Could not parse a spreadsheet ID from: ${input}`);
      process.exit(1);
    }
    const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    if (config.spreadsheets.some(s => s.id === id)) {
      console.log(`Sheet ${id} is already in the config.`);
      break;
    }
    config.spreadsheets.push({ id });
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
    console.log(`Added spreadsheet ${id} to sheets.config.json.`);
    break;
  }

  default:
    console.log('Usage: comms <command>');
    console.log('Commands:');
    console.log('  profiles                          List all profiles');
    console.log('  add-sheet <url-or-id>             Add a Google Sheets file to the config');
  console.log('  import-csv <file> <sheet-name>    Import people from a CSV into a sheet tab');
    console.log('  log-whatsapp <name> <message>     Log a sent WhatsApp message');
  console.log('  send-blast <group> <template>     Send a templated email to a whole group');
  console.log('  send-email <name> <template>      Preview and send a templated email');
  console.log('  log-email <name> <subject>        Log a sent email (no send)');
}
