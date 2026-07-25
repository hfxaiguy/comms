#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadProfiles, logMessage, appendPerson } from './src/profiles.mjs';
import { getProfiles, getAttributes, getRelationships, migrateTextRelationships, searchProfiles, findProfileByName, addAttribute, updateAttribute, deleteAttribute } from './src/db.mjs';
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
    const attrs = getAttributes(p.id);
    const rels  = getRelationships(p.id);

    const get = (type) => {
      const a = attrs.filter(x => x.type === type);
      return a.map(x => JSON.parse(x.data));
    };
    const getText = (type) => get(type).filter(v => typeof v === 'string');

    const name  = [p.first_name, p.last_name].filter(Boolean).join(' ') || '(unnamed)';
    const group = p.group_name ? `  [${p.group_name}]` : '';
    console.log(`\n── ${name}${group}`);

    const connectionLevel = getText('connection_level')[0];
    const met             = getText('met')[0];
    const dateAdded       = getText('date_added')[0];
    if (dateAdded)       console.log(`   added      ${dateAdded}`);
    if (connectionLevel) console.log(`   connection ${connectionLevel}`);
    if (met)             console.log(`   met        ${met}`);

    const cards = getText('card');
    if (cards.length) cards.forEach(c => console.log(`   card       ${c}`));

    const emails = get('email');
    if (emails.length)
      emails.forEach(e => console.log(`   email      ${e.address}${e.label ? ` (${e.label})` : ''}`));
    const phones = get('phone');
    if (phones.length)
      phones.forEach(e => console.log(`   phone      ${e.number}${e.label ? ` (${e.label})` : ''}`));
    const websites = get('website');
    if (websites.length)
      websites.forEach(e => console.log(`   website    ${e.url}${e.label ? ` (${e.label})` : ''}`));
    const socials = get('social');
    if (socials.length)
      socials.forEach(e => console.log(`   social     ${e.url}${e.label ? ` (${e.label})` : ''}`));

    const professions = getText('profession');
    if (professions.length) professions.forEach(x => console.log(`   profession ${x}`));
    const companies = getText('company');
    if (companies.length) companies.forEach(x => console.log(`   company    ${x}`));
    const podcasts = getText('podcast');
    if (podcasts.length) podcasts.forEach(x => console.log(`   podcast    ${x}`));

    const interests = getText('interest');
    if (interests.length) interests.forEach(i => console.log(`   interest   ${i}`));

    if (rels.length)
      rels.forEach(r => {
        const label = r.type === 'with' ? 'with' : 'related to';
        console.log(`   ${label.padEnd(12)}${r.linked_name.trim() || `(profile #${r.linked_profile_id})`}`);
      });

    // Show any remaining text-based relationships (unmatched during migration)
    const relatedTo = getText('related_to');
    if (relatedTo.length) relatedTo.forEach(x => console.log(`   related to ${x}`));
    const withText = getText('with');
    if (withText.length) withText.forEach(x => console.log(`   with       ${x}`));

    const proposals = getText('proposal');
    if (proposals.length) proposals.forEach(i => console.log(`   propose    ${i}`));
    const promises = getText('promise');
    if (promises.length) promises.forEach(x => console.log(`   promise    ${x}`));

    const notes = getText('note');
    if (notes.length) notes.forEach(n => console.log(`   note       ${n}`));

    const messages = get('message');
    if (messages.length)
      messages.forEach(m => {
        const meta = [m.dateSent, m.status, m.channel].filter(Boolean).join(' · ');
        console.log(`   message    ${m.text || '(empty)'}${meta ? `  [${meta}]` : ''}`);
      });
  }
  console.log();
}

const [,, command, ...args] = process.argv;

switch (command) {
  case 'profiles': {
    const profiles = getProfiles();
    printProfiles(profiles);
    break;
  }

  case 'search': {
    const query = args.join(' ').trim();
    if (!query) {
      console.error('Usage: comms search <query>');
      process.exit(1);
    }
    const results = searchProfiles(query);
    if (results.length === 0) {
      console.log(`No profiles matching "${query}".`);
    } else {
      console.log(`${results.length} result(s) for "${query}":\n`);
      for (const p of results) {
        const attrs = getAttributes(p.id);
        const get = (type) => {
          const a = attrs.filter(x => x.type === type);
          return a.map(x => JSON.parse(x.data));
        };
        const getText = (type) => get(type).filter(v => typeof v === 'string');
        const name = [p.first_name, p.last_name].filter(Boolean).join(' ') || '(unnamed)';
        const group = p.group_name ? `  [${p.group_name}]` : '';
        const company = getText('company')[0] ?? '';
        const email = get('email')[0]?.address ?? '';
        const parts = [`── ${name}${group}`];
        if (company) parts.push(`company: ${company}`);
        if (email)   parts.push(`email: ${email}`);
        console.log(parts.join('  ·  '));
      }
    }
    console.log();
    break;
  }

  case 'edit': {
    const nameArg = args.filter(a => !a.startsWith('--')).join(' ').trim();
    if (!nameArg) {
      console.error('Usage: comms edit <name> [--set type=value] [--add type=value] [--delete <attr-id>]');
      process.exit(1);
    }

    const profile = findProfileByName(nameArg);
    if (!profile) {
      console.error(`No profile found matching "${nameArg}".`);
      process.exit(1);
    }

    const attrs = getAttributes(profile.id);
    const firstName = attrs.find(a => a.type === 'first_name');
    const lastName  = attrs.find(a => a.type === 'last_name');
    const profileName = [
      firstName && JSON.parse(firstName.data),
      lastName  && JSON.parse(lastName.data),
    ].filter(Boolean).join(' ') || '(unnamed)';

    const setArgs   = args.filter(a => a.startsWith('--set')).map((_, i) => args[args.indexOf('--set') + 1 + i]).filter(Boolean);
    const addArgs   = args.filter(a => a.startsWith('--add')).map((_, i) => args[args.indexOf('--add') + 1 + i]).filter(Boolean);
    const delArgs   = args.filter(a => a.startsWith('--delete')).map((_, i) => args[args.indexOf('--delete') + 1 + i]).filter(Boolean);

    // Parse --set flags
    for (const flag of args) {
      if (flag === '--set' || flag === '--add' || flag === '--delete') continue;
    }

    const parseFlag = (arg) => {
      const eq = arg.indexOf('=');
      if (eq === -1) return null;
      return { type: arg.slice(0, eq).trim(), value: arg.slice(eq + 1).trim() };
    };

    // Collect flag values properly
    const setFlags = [];
    const addFlags = [];
    const delFlags = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--set' && args[i + 1])    { setFlags.push(args[++i]); }
      else if (args[i] === '--add' && args[i + 1])    { addFlags.push(args[++i]); }
      else if (args[i] === '--delete' && args[i + 1]) { delFlags.push(args[++i]); }
    }

    const FRESH_DATA = {
      email:   (v) => JSON.stringify({ address: v, label: '' }),
      phone:   (v) => JSON.stringify({ number: v, label: '' }),
      website: (v) => JSON.stringify({ url: v, label: '' }),
      social:  (v) => JSON.stringify({ url: v, label: '', status: '', lastChecked: '' }),
    };

    let changed = 0;

    if (setFlags.length) {
      for (const arg of setFlags) {
        const parsed = parseFlag(arg);
        if (!parsed) { console.error(`Invalid --set format: "${arg}". Use --set type=value`); continue; }
        const { type, value } = parsed;
        const existing = attrs.find(a => a.type === type);
        if (!existing) {
          console.error(`No existing "${type}" attribute on ${profileName}. Use --add to create one.`);
          continue;
        }
        const newData = typeof JSON.parse(existing.data) === 'string'
          ? JSON.stringify(value)
          : (() => {
              const v = JSON.parse(existing.data);
              if (v.address !== undefined) return JSON.stringify({ ...v, address: value });
              if (v.number  !== undefined) return JSON.stringify({ ...v, number: value });
              if (v.url     !== undefined) return JSON.stringify({ ...v, url: value });
              if (v.text    !== undefined) return JSON.stringify({ ...v, text: value });
              return JSON.stringify(value);
            })();
        updateAttribute(existing.id, newData);
        console.log(`Updated ${profileName}: ${type} = ${value}`);
        changed++;
      }
    }

    if (addFlags.length) {
      for (const arg of addFlags) {
        const parsed = parseFlag(arg);
        if (!parsed) { console.error(`Invalid --add format: "${arg}". Use --add type=value`); continue; }
        const { type, value } = parsed;
        const freshFn = FRESH_DATA[type];
        const data = freshFn ? freshFn(value) : JSON.stringify(value);
        addAttribute(profile.id, type, data);
        console.log(`Added to ${profileName}: ${type} = ${value}`);
        changed++;
      }
    }

    if (delFlags.length) {
      for (const idStr of delFlags) {
        const id = parseInt(idStr, 10);
        if (isNaN(id)) { console.error(`Invalid attribute ID: "${idStr}"`); continue; }
        const attr = attrs.find(a => a.id === id);
        if (!attr) { console.error(`Attribute #${id} not found on ${profileName}.`); continue; }
        deleteAttribute(id);
        console.log(`Deleted attribute #${id} (${attr.type}) from ${profileName}`);
        changed++;
      }
    }

    if (!setFlags.length && !addFlags.length && !delFlags.length) {
      // No flags: just print the profile
      console.log(`Profile: ${profileName} (id: ${profile.id})\n`);
      const LABEL_W = 16;
      for (const a of attrs) {
        if (a.type === 'first_name' || a.type === 'last_name') continue;
        const v = JSON.parse(a.data);
        let display;
        if (typeof v === 'string') display = v;
        else if (v.address) display = v.address;
        else if (v.number)  display = v.number;
        else if (v.url)     display = v.url;
        else if (v.text)    display = v.text;
        else display = JSON.stringify(v);
        const label = a.type.padEnd(LABEL_W);
        console.log(`  #${String(a.id).padEnd(4)} ${label} ${display}`);
      }
      const rels = getRelationships(profile.id);
      if (rels.length) {
        console.log();
        for (const r of rels) {
          const label = (r.type === 'with' ? 'with' : 'related to').padEnd(LABEL_W);
          console.log(`  rel  ${label} ${r.linked_name.trim() || `profile #${r.linked_profile_id}`}`);
        }
      }
      console.log();
      console.log('Flags: --set type=value  --add type=value  --delete <attr-id>');
    } else if (changed) {
      console.log(`\n${changed} change(s) applied.`);
    }

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

  case 'migrate-relationships': {
    const result = migrateTextRelationships();
    console.log(`Relationships migrated: ${result.migrated} linked, ${result.unmatched} unmatched.`);
    break;
  }

  case 'import-podcast-attendees': {
    await import('./src/import-podcast-attendees.mjs');
    break;
  }

  case 'help': {
    console.log('Usage: comms [command]');
    console.log('');
    console.log('  (no command)                           Open the TUI');
    console.log('  profiles                               List all profiles from DB');
    console.log('  search <query>                         Search profiles by name, email, company, etc.');
    console.log('  edit <name> [--set k=v] [--add k=v]    View or edit a profile');
    console.log('                 [--delete <attr-id>]');
    console.log('  add-person                             Add a new person interactively');
    console.log('  migrate [--force]                      Import profiles from Google Sheets');
    console.log('  migrate-relationships                  Link text relationships to profile IDs');
    console.log('  import-csv <file> [--group <name>]     Import people from a CSV into the DB');
    console.log('  import-podcast-attendees [--force]     Import Podcast Show attendees');
    console.log('  add-sheet <url-or-id>                  Add a Google Sheets file to the config');
    console.log('  process-cards [--reprocess]            Extract contacts from business cards');
    console.log('  send-email <name> <template>           Preview and send a templated email');
    console.log('  send-blast <group> <template>          Send a templated email to a group');
    console.log('  log-whatsapp <name> <message>          Log a sent WhatsApp message');
    console.log('  log-email <name> <subject>             Log a sent email (no send)');
    console.log('  test-email <address>                   Send a test email to verify SMTP');
    console.log('  bust-cache                             Refresh tab-completion cache');
    console.log('  help                                   Show this help');
    break;
  }

  default: {
    const { launchTUI } = await import('./src/tui/app.mjs');
    await launchTUI();
    break;
  }
}
