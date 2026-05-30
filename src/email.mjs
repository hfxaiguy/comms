import { readFileSync, readdirSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';
import { loadProfiles, logMessage } from './profiles.mjs';
import { previewEmail, previewEmailBlast, confirmSendToRest } from './prompt.mjs';
import { saveToSent } from './imap.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = process.env.EMAIL_TEMPLATES_DIR ?? path.join(__dirname, '..', 'email-templates');
const CONFIG_PATH   = process.env.EMAIL_CONFIG_PATH   ?? path.join(__dirname, '..', 'email.config.json');

function getAccountForGroup(group) {
  if (!existsSync(CONFIG_PATH)) {
    throw new Error(
      `Missing email.config.json at ${CONFIG_PATH}\n` +
      `Create it with:\n` +
      `{\n` +
      `  "default": { "from": "You <you@gmail.com>", "smtp": { "host": "smtp.gmail.com", "port": 587, "auth": { "user": "you@gmail.com", "pass": "app-password" } } },\n` +
      `  "groups": {\n` +
      `    "Group Name": { "from": "Other <other@example.com>", "smtp": { ... } }\n` +
      `  }\n` +
      `}`
    );
  }
  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  const account = config.groups?.[group] ?? config.default;
  if (!account) throw new Error(`No email account configured for group "${group}" and no default set.`);
  return account;
}

export function listTemplates() {
  return readdirSync(TEMPLATES_DIR)
    .filter(f => f.endsWith('.txt'))
    .map(f => path.basename(f, '.txt'));
}

function loadTemplate(name) {
  const filePath = path.join(TEMPLATES_DIR, `${name}.txt`);
  if (!existsSync(filePath)) {
    throw new Error(`Template "${name}" not found in ${TEMPLATES_DIR}`);
  }

  const lines = readFileSync(filePath, 'utf8').split('\n');
  let subject = '';
  let bodyStart = 1;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase().startsWith('subject:')) {
      subject = lines[i].slice(lines[i].indexOf(':') + 1).trim();
    } else if (lines[i].toLowerCase().startsWith('body:')) {
      bodyStart = i + 1;
      break;
    }
  }

  return { subject, body: lines.slice(bodyStart).join('\n').replace(/^\n+/, '') };
}

function render(text, profile) {
  const vars = {
    first_name: profile.firstName,
    last_name:  profile.lastName,
    full_name:  [profile.firstName, profile.lastName].filter(Boolean).join(' '),
    group:      profile.group,
    email:      profile.emails[0]?.address ?? '',
  };
  return text.replace(/\[(\w+)\]/g, (match, key) => vars[key] ?? match);
}

export async function sendEmail(firstName, templateName) {
  const profiles = await loadProfiles();
  const nameLower = firstName.trim().toLowerCase();
  const profile = profiles.find(p => p.firstName.toLowerCase() === nameLower);

  if (!profile) throw new Error(`No person found with first name "${firstName}"`);

  if (profile.messages.some(m => m.templateName === templateName)) {
    throw new Error(`"${templateName}" was already sent to ${firstName}.`);
  }

  const toEmail = profile.emails[0]?.address;
  if (!toEmail) throw new Error(`${firstName} has no email address on file.`);

  const template = loadTemplate(templateName);
  const subject  = render(template.subject, profile);
  const body     = render(template.body, profile);

  const account = getAccountForGroup(profile.group);

  const confirmed = await previewEmail({ to: toEmail, from: account.from, subject, body });
  if (!confirmed) { console.log('Cancelled.'); return; }

  const mailOptions = { from: account.from, to: toEmail, subject, text: body };
  const transporter = nodemailer.createTransport(account.smtp);
  await transporter.sendMail(mailOptions);
  await saveToSent(account.imap, mailOptions);

  await logMessage(firstName, subject, 'Email', 'sent', templateName);
  console.log(`Sent and logged.`);
}

export async function sendBlast(groupName, templateName) {
  const profiles = await loadProfiles();

  const members = profiles.filter(p => p.group === groupName);
  if (!members.length) throw new Error(`No people found in group "${groupName}".`);

  const noEmail  = members.filter(p => !p.emails[0]?.address);
  const pending  = members.filter(p =>
    p.emails[0]?.address && !p.messages.some(m => m.templateName === templateName)
  );
  const skippedCount = members.length - pending.length - noEmail.length;

  console.log(`Group "${groupName}": ${pending.length} to send, ${skippedCount} already sent, ${noEmail.length} without email.`);
  if (!pending.length) return;

  const account  = getAccountForGroup(groupName);
  const template = loadTemplate(templateName);

  const doSend = async (profile) => {
    const toEmail     = profile.emails[0].address;
    const subject     = render(template.subject, profile);
    const body        = render(template.body, profile);
    const mailOptions = { from: account.from, to: toEmail, subject, text: body };
    const transporter = nodemailer.createTransport(account.smtp);
    await transporter.sendMail(mailOptions);
    await saveToSent(account.imap, mailOptions);
    await logMessage(profile.firstName, subject, 'Email', 'sent', templateName);
    const name = [profile.firstName, profile.lastName].filter(Boolean).join(' ');
    console.log(`  ✓ ${name}`);
  };

  let i = 0;
  while (i < pending.length) {
    const profile = pending[i];
    const toEmail = profile.emails[0].address;
    const subject = render(template.subject, profile);
    const body    = render(template.body, profile);

    const choice = await previewEmailBlast({
      from:      account.from,
      to:        toEmail,
      subject,
      body,
      restCount: pending.length - i - 1,
    });

    if (choice === 'send') {
      await doSend(profile);
      i++;
    } else if (choice === 'skip') {
      i++;
    } else {
      // 'rest' — confirm then bulk send remaining
      const rest = pending.slice(i);
      const confirmed = await confirmSendToRest(rest);
      if (confirmed) {
        for (const p of rest) await doSend(p);
        break;
      }
      // declined — continue reviewing individually from current position
    }
  }
}
