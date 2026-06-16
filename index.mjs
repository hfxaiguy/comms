#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadProfiles, logMessage, appendPerson } from './src/profiles.mjs';
import { readDescription, parseDescription, previewPerson } from './src/create.mjs';
import { importCsv, importCsvToDb } from './src/import.mjs';
import { sendEmail, sendBlast, listTemplates } from './src/email.mjs';
import { processCards } from './src/cards.mjs';
import { saveToSent } from './src/imap.mjs';
import { arrowSelect } from './src/prompt.mjs';
import nodemailer from 'nodemailer';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, 'sheets.config.json');
const CACHE_PATH  = path.join(__dirname, '.comms-cache.json');

function readCache() {
  try { return JSON.parse(readFileSync(CACHE_PATH, 'utf8')); }
  catch { return null; }
}

function writeCache(profiles) {
  const names  = profiles.map(p => [p.firstName, [p.firstName, p.lastName].filter(Boolean).join(' ')]);
  const groups = [...new Set(profiles.map(p => p.group).filter(Boolean))];
  writeFileSync(CACHE_PATH, JSON.stringify({ names, groups }, null, 2) + '\n');
}

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

    if (p.cards.length)
      p.cards.forEach(c => console.log(`   card       ${c}`));
    if (p.connectionLevel) console.log(`   connection ${p.connectionLevel}`);
    if (p.met)             console.log(`   met        ${p.met}`);

    if (p.emails.length)
      p.emails.forEach(e => console.log(`   email      ${e.address}${e.label ? ` (${e.label})` : ''}`));
    if (p.phones.length)
      p.phones.forEach(e => console.log(`   phone      ${e.number}${e.label ? ` (${e.label})` : ''}`));
    if (p.websites.length)
      p.websites.forEach(e => console.log(`   website    ${e.url}${e.label ? ` (${e.label})` : ''}`));
    if (p.socials.length)
      p.socials.forEach(e => console.log(`   social     ${e.url}${e.label ? ` (${e.label})` : ''}`));

    if (p.professions.length)
      p.professions.forEach(x => console.log(`   profession ${x.text}`));
    if (p.companies.length)
      p.companies.forEach(x => console.log(`   company    ${x.text}`));
    if (p.podcasts.length)
      p.podcasts.forEach(x => console.log(`   podcast    ${x.text}`));

    if (p.interests.length)
      p.interests.forEach(i => console.log(`   interest   ${i.text}`));
    if (p.relatedTo.length)
      p.relatedTo.forEach(x => console.log(`   related to ${x.text}`));
    if (p.with.length)
      p.with.forEach(x => console.log(`   with       ${x.text}`));

    if (p.proposals.length)
      p.proposals.forEach(i => console.log(`   propose    ${i.text}`));
    if (p.promises.length)
      p.promises.forEach(x => console.log(`   promise    ${x.text}`));

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

  // Internal: used by fish tab completion — reads from cache only (fast)
  case '_names': {
    const cache = readCache();
    if (cache) cache.names.forEach(([first, full]) => console.log(`${first}\t${full}`));
    break;
  }

  case '_groups': {
    const cache = readCache();
    if (cache) cache.groups.forEach(g => console.log(g));
    break;
  }

  case '_templates': {
    listTemplates().forEach(t => console.log(t));
    break;
  }

  case 'add-person': {
    const profiles = await loadProfiles();
    const groups   = [...new Set(profiles.map(p => p.group).filter(Boolean))];

    if (!groups.length) {
      console.error('No groups found.');
      process.exit(1);
    }

    console.log('\nWhich group?');
    const groupIdx = await arrowSelect(groups);
    const group    = groups[groupIdx];

    console.log();
    const description = await readDescription();
    if (!description) { console.log('Nothing entered.'); break; }

    const fields = await parseDescription(description);
    previewPerson(fields);

    const go = await arrowSelect(['Save', 'Cancel']);
    if (go !== 0) break;

    await appendPerson(group, fields);
    console.log('Saved.');
    break;
  }

  case 'process-cards': {
    await processCards({ reprocess: args.includes('--reprocess') });
    break;
  }

  case 'bust-cache': {
    process.stdout.write('Fetching profiles... ');
    const profiles = await loadProfiles();
    writeCache(profiles);
    console.log(`done (${profiles.length} people, ${[...new Set(profiles.map(p => p.group).filter(Boolean))].length} groups).`);
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

  case 'test-email': {
    const [to] = args;
    if (!to) {
      console.error('Usage: comms test-email <address>');
      process.exit(1);
    }
    const emailConfig = JSON.parse(readFileSync(path.join(__dirname, 'email.config.json'), 'utf8'));
    const account = emailConfig.default;
    if (!account) throw new Error('No "default" account found in email.config.json.');
    const mailOptions = {
      from:    account.from,
      to,
      subject: 'comms config test',
      text:    'If you received this, SMTP is working.',
    };
    process.stdout.write('Sending via SMTP... ');
    const transporter = nodemailer.createTransport(account.smtp);
    await transporter.sendMail(mailOptions);
    console.log('ok');
    if (account.imap) {
      process.stdout.write('Saving to Sent via IMAP... ');
      await saveToSent(account.imap, mailOptions);
      console.log('ok');
    } else {
      console.log('No IMAP config — skipping Sent folder.');
    }
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
    const [csvPath, ...importRest] = args;
    if (!csvPath) {
      console.error('Usage: comms import-csv <file.csv> [--group <name>]');
      process.exit(1);
    }
    const groupFlagIdx = importRest.indexOf('--group');
    const forceGroup   = groupFlagIdx !== -1 ? importRest[groupFlagIdx + 1] : undefined;
    const { added, groupsAdded, skipped, unknown } = importCsvToDb(csvPath, forceGroup);
    console.log(`Imported ${added} new profiles.`);
    if (groupsAdded) console.log(`Added group to ${groupsAdded} existing profiles.`);
    if (skipped)     console.log(`${skipped} duplicates already in that group, skipped.`);
    if (unknown.length) console.log(`Unknown columns ignored: ${unknown.join(', ')}`);
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

  case 'migrate': {
    await import('./src/migrate.mjs');
    break;
  }

  case 'help': {
    console.log('Usage: comms [command]');
    console.log('');
    console.log('  (no command)                    Open the TUI');
    console.log('  migrate [--force]               Import profiles from Google Sheets into SQLite');
    console.log('  profiles                        Print all profiles (legacy)');
    console.log('  bust-cache                      Refresh tab-completion cache');
    console.log('  add-person                      Add a new person interactively');
    console.log('  process-cards [--reprocess]     Extract contacts from business card images');
    console.log('  add-sheet <url-or-id>           Add a Google Sheets file to the config');
    console.log('  import-csv <file> [--group <n>] Import people from a CSV into the DB');
    console.log('  log-whatsapp <name> <message>   Log a sent WhatsApp message');
    console.log('  send-blast <group> <template>   Send a templated email to a whole group');
    console.log('  send-email <name> <template>    Preview and send a templated email');
    console.log('  log-email <name> <subject>      Log a sent email (no send)');
    break;
  }

  default: {
    const { launchTUI } = await import('./src/tui/app.mjs');
    await launchTUI();
    break;
  }
}
