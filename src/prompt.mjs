import { spawnSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import os from 'os';
import path from 'path';

/** Prints the email to stdout and asks Send / Don't send. Returns true if the user chose Send. */
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

/**
 * Opens the email in `less`, then asks Send / Don't send / Send to rest.
 * @returns {'send' | 'skip' | 'rest'}
 */
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

/** Lists the remaining recipients and asks whether to send to all of them at once. */
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

/**
 * Interactive multi-select checklist, similar to `git add -i`.
 * Arrow keys move the cursor, Space toggles, Enter confirms, 'a' toggles all.
 * All items are selected by default.
 * Resolves with an array of the selected indices.
 */
export async function checkSelect(options) {
  let cursor   = 0;
  const selected = new Set(options.map((_, i) => i)); // all on by default

  const render = (redraw) => {
    const cols = process.stdout.columns || 80;
    if (redraw) {
      const totalLines = options.reduce(
        (sum, opt) => sum + Math.max(1, Math.ceil((opt.length + 6) / cols)),
        0
      ) + 1; // +1 for the hint line
      process.stdout.write(`\x1b[${totalLines}A`);
    }
    for (let i = 0; i < options.length; i++) {
      const pointer  = i === cursor ? '▶' : ' ';
      const checkbox = selected.has(i) ? '[x]' : '[ ]';
      process.stdout.write(`\r${pointer} ${checkbox} ${options[i]}\x1b[K\n`);
    }
    process.stdout.write(`\r\x1b[2m↑↓ move  space toggle  a all/none  enter confirm\x1b[0m\x1b[K\n`);
  };

  render(false);

  return new Promise((resolve) => {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    const onData = (key) => {
      if (key === '\x1b[A') {
        cursor = Math.max(0, cursor - 1);
        render(true);
      } else if (key === '\x1b[B') {
        cursor = Math.min(options.length - 1, cursor + 1);
        render(true);
      } else if (key === ' ') {
        selected.has(cursor) ? selected.delete(cursor) : selected.add(cursor);
        render(true);
      } else if (key === 'a') {
        if (selected.size === options.length) selected.clear();
        else options.forEach((_, i) => selected.add(i));
        render(true);
      } else if (key === '\r' || key === '\n') {
        process.stdin.removeListener('data', onData);
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdout.write('\n');
        resolve([...selected].sort((a, b) => a - b));
      } else if (key === '\x03') {
        process.exit();
      }
    };

    process.stdin.on('data', onData);
  });
}

/**
 * Renders `options` as an arrow-key menu and resolves with the chosen index.
 * Exits the process on Ctrl-C.
 */
export async function arrowSelect(options) {
  let idx = 0;

  const render = (redraw) => {
    const cols = process.stdout.columns || 80;
    if (redraw) {
      // Each option may wrap across multiple terminal lines — count them all before moving up
      const totalLines = options.reduce(
        (sum, opt) => sum + Math.max(1, Math.ceil((opt.length + 2) / cols)),
        0
      );
      process.stdout.write(`\x1b[${totalLines}A`);
    }
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
