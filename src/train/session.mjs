import { spawnSync } from 'child_process';
import { writeFileSync, readFileSync } from 'fs';
import { createInterface } from 'readline';
import os from 'os';
import path from 'path';
import { launchBrowser } from '../enrichment/browser.mjs';
import { arrowSelect } from '../prompt.mjs';
import { generateCode, reviseCode } from './generate.mjs';
import { saveAutomation, readAutomationCode, listAutomations } from './store.mjs';

const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;

/** Reads multiple lines until a blank line is entered, returns joined text. */
async function readBlock(prompt) {
  console.log(`${prompt} (blank line to submit):\n`);
  const rl    = createInterface({ input: process.stdin, output: process.stdout });
  const lines = [];
  return new Promise(resolve => {
    rl.on('line', line => {
      if (!line.trim() && lines.length) { rl.close(); resolve(lines.join('\n').trim()); }
      else lines.push(line);
    });
    rl.on('close', () => resolve(lines.join('\n').trim()));
  });
}

/** Reads individual lines until a blank line, returns array of non-empty entries. */
async function readList(prompt) {
  console.log(`${prompt} (blank line when done):\n`);
  const rl    = createInterface({ input: process.stdin, output: process.stdout });
  const items = [];
  return new Promise(resolve => {
    rl.on('line', line => {
      if (!line.trim() && items.length) { rl.close(); resolve(items); }
      else if (line.trim()) items.push(line.trim());
    });
    rl.on('close', () => resolve(items));
  });
}

/** Reads a single line after printing a prompt. */
async function readOne(prompt) {
  process.stdout.write(`${prompt}: `);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.once('line', line => { rl.close(); resolve(line.trim()); });
  });
}

function showCode(code, title = 'Code') {
  const width = Math.min(process.stdout.columns || 80, 100);
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, width - title.length - 4))}`);
  console.log(code);
  console.log('─'.repeat(width) + '\n');
}

async function editInEditor(code) {
  const tmpFile = path.join(os.tmpdir(), `comms-train-${Date.now()}.mjs`);
  writeFileSync(tmpFile, code, 'utf8');
  const editor = process.env.EDITOR || 'vi';
  spawnSync(editor, [tmpFile], { stdio: 'inherit' });
  return readFileSync(tmpFile, 'utf8').trim();
}

async function runCode(page, code, url) {
  try {
    const fn     = new AsyncFunction('page', 'ctx', code);
    const result = await fn(page, { url });
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Core verdict loop: show code, run it, collect feedback, revise, or save.
 * `initialUrl` is used for the first run and as fallback for revision context.
 * `savedMeta` carries name/description/sampleUrls when editing an existing automation.
 */
async function verdictLoop(page, initialCode, initialUrl, savedMeta = null, initialExplanation = '') {
  let code        = initialCode;
  let explanation = initialExplanation;
  let lastResult  = null;
  let lastHtml    = null;
  let activeUrl   = initialUrl;

  while (true) {
    if (explanation) console.log(`\nKimi: ${explanation}\n`);
    showCode(code, 'Code to run');

    const action = await arrowSelect(['Run this', 'Edit manually', 'Cancel']);

    if (action === 2) return;

    if (action === 1) {
      code = await editInEditor(code);
      continue;
    }

    // Run
    console.log();
    const { ok, result, error } = await runCode(page, code, activeUrl);
    lastHtml = await page.content();

    if (!ok) {
      console.log(`Error: ${error}\n`);
    } else {
      lastResult = result;
      console.log('Result:');
      console.log(JSON.stringify(result, null, 2) + '\n');
    }

    const verdict = await arrowSelect([
      'Correct — save this automation',
      'Test with a different URL',
      'Wrong — give feedback',
      'Edit manually',
      'Cancel',
    ]);

    if (verdict === 0) {
      let name        = savedMeta?.name        ?? '';
      let description = savedMeta?.description ?? '';
      let sampleUrls  = savedMeta?.sampleUrls  ?? [activeUrl];

      if (!name) {
        name = await readOne('\nName this automation (e.g. check-open-to-work)');
        name = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        if (!name) { console.log('Invalid name, cancelled.'); break; }
      }
      if (!description) {
        description = await readOne('One-line description');
      }

      const savedPath = saveAutomation(name, description, sampleUrls, code);
      console.log(`\nSaved to ${savedPath}`);
      break;
    }

    if (verdict === 1) {
      const testUrl = await readOne('\nURL to test');
      if (!testUrl) { console.log('No URL entered.'); continue; }
      activeUrl = testUrl;
      console.log();
      const { ok: tok, result: tresult, error: terr } = await runCode(page, code, testUrl);
      lastHtml = await page.content();
      if (!tok) {
        console.log(`Error: ${terr}\n`);
      } else {
        lastResult = tresult;
        console.log('Result:');
        console.log(JSON.stringify(tresult, null, 2) + '\n');
      }
      continue;
    }

    if (verdict === 2) {
      const feedback = await readBlock('\nWhat was wrong?');
      process.stdout.write('\nRevising... ');
      const revised = await reviseCode(code, lastResult, feedback, lastHtml ?? '');
      console.log('done.');
      explanation = revised.explanation;
      code        = revised.code;
      continue;
    }

    if (verdict === 3) {
      code = await editInEditor(code);
      continue;
    }

    break; // Cancel
  }
}

/** Runs a full training session: describe → generate → verify-before-run → iterate → save. */
export async function runTrainingSession() {
  const description = await readBlock('Describe the task');
  if (!description) { console.log('Nothing entered.'); return; }

  const sampleUrls = await readList('Sample URL(s)');
  if (!sampleUrls.length) { console.log('No URLs provided.'); return; }

  const sampleUrl = sampleUrls[0];

  process.stdout.write('\nGenerating code... ');
  const { explanation, code } = await generateCode(description, sampleUrl);
  console.log('done.');

  const context = await launchBrowser();
  const page    = context.pages()[0] ?? await context.newPage();

  try {
    await verdictLoop(page, code, sampleUrl, { description, sampleUrls }, explanation);
  } finally {
    await context.close();
  }
}

/** Loads an existing automation by name and opens the verdict loop directly. */
export async function runExistingAutomation(name) {
  let code;
  try {
    code = readAutomationCode(name);
  } catch (err) {
    console.error(err.message);
    console.log('\nAvailable automations:');
    const names = listAutomations();
    if (names.length) names.forEach(n => console.log(`  • ${n}`));
    else console.log('  (none)');
    return;
  }

  showCode(code, `Automation: ${name}`);

  const url = await readOne('URL to run against');
  if (!url) { console.log('No URL entered.'); return; }

  const context = await launchBrowser();
  const page    = context.pages()[0] ?? await context.newPage();

  try {
    await verdictLoop(page, code, url, { name });
  } finally {
    await context.close();
  }
}
