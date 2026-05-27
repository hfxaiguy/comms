import { spawnSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import os from 'os';
import path from 'path';

// Used for individual send-email
export async function previewEmail({ from, to, subject, body }) {
  const width = Math.min(process.stdout.columns || 80, 100);
  const rule = '─'.repeat(width);

  process.stdout.write(`\n${rule}\n`);
  process.stdout.write(`From:    ${from}\n`);
  process.stdout.write(`To:      ${to}\n`);
  process.stdout.write(`Subject: ${subject}\n`);
  process.stdout.write(`${rule}\n`);
  process.stdout.write(`${body}\n`);
  process.stdout.write(`${rule}\n\n`);

  const choice = await arrowSelect(['Send', "Don't send"]);
  return choice === 0;
}

// Used for blast: opens less, then shows Send / Don't send / Send to rest (N more)
// Returns 'send' | 'skip' | 'rest'
export async function previewEmailBlast({ from, to, subject, body, restCount }) {
  const content = `From:    ${from}\nTo:      ${to}\nSubject: ${subject}\n\n${body}`;
  const tmpFile = path.join(os.tmpdir(), `comms-preview-${Date.now()}.txt`);

  try {
    writeFileSync(tmpFile, content, 'utf8');
    spawnSync('less', [tmpFile], { stdio: 'inherit' });
  } finally {
    unlinkSync(tmpFile);
  }

  const options = [
    'Send',
    "Don't send",
    ...(restCount > 0 ? [`Send to rest (${restCount} more)`] : []),
  ];

  const idx = await arrowSelect(options);
  if (idx === 0) return 'send';
  if (idx === 1) return 'skip';
  return 'rest';
}

// Shows a list of names and asks yes/no
export async function confirmSendToRest(profiles) {
  process.stdout.write(`\nWill send to:\n`);
  for (const p of profiles) {
    const name = [p.firstName, p.lastName].filter(Boolean).join(' ');
    process.stdout.write(`  • ${name} <${p.emails[0].address}>\n`);
  }
  process.stdout.write('\n');

  const idx = await arrowSelect(['Yes, send to all', 'No, review individually']);
  return idx === 0;
}

async function arrowSelect(options) {
  let idx = 0;

  const render = (redraw) => {
    if (redraw) process.stdout.write(`\x1b[${options.length}A`);
    for (let i = 0; i < options.length; i++) {
      process.stdout.write(`\r${i === idx ? '▶ ' : '  '}${options[i]}\x1b[K\n`);
    }
  };

  render(false);

  return new Promise((resolve) => {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    const onData = (key) => {
      if (key === '\x1b[A') {
        idx = Math.max(0, idx - 1);
        render(true);
      } else if (key === '\x1b[B') {
        idx = Math.min(options.length - 1, idx + 1);
        render(true);
      } else if (key === '\r' || key === '\n') {
        process.stdin.removeListener('data', onData);
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdout.write('\n');
        resolve(idx);
      } else if (key === '\x03') {
        process.exit();
      }
    };

    process.stdin.on('data', onData);
  });
}
