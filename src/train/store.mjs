import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname       = path.dirname(fileURLToPath(import.meta.url));
const AUTOMATIONS_DIR = path.join(__dirname, '..', '..', 'automations');

/** Returns the names of all saved automations. */
export function listAutomations() {
  if (!existsSync(AUTOMATIONS_DIR)) return [];
  return readdirSync(AUTOMATIONS_DIR)
    .filter(f => f.endsWith('.mjs'))
    .map(f => path.basename(f, '.mjs'));
}

/**
 * Reads a saved automation's function body as a plain string.
 * Strips the 2-space indentation added by saveAutomation.
 */
export function readAutomationCode(name) {
  const filePath = path.join(AUTOMATIONS_DIR, `${name}.mjs`);
  if (!existsSync(filePath)) throw new Error(`Automation "${name}" not found.`);
  const src   = readFileSync(filePath, 'utf8');
  const match = src.match(/export async function run\(page, ctx\) \{\n([\s\S]*?)\n\}\n?$/);
  if (!match) throw new Error(`Could not parse function body from "${name}.mjs".`);
  return match[1].replace(/^  /gm, '').trim();
}

/** Dynamically imports a saved automation module by name. */
export async function loadAutomation(name) {
  const filePath = path.join(AUTOMATIONS_DIR, `${name}.mjs`);
  if (!existsSync(filePath)) throw new Error(`Automation "${name}" not found.`);
  return import(filePath);
}

/**
 * Runs a saved automation against `page` with the given context object.
 * No prompts — intended for production use from other commands.
 */
export async function runAutomation(name, page, ctx) {
  const { run } = await loadAutomation(name);
  return run(page, ctx);
}

/**
 * Writes a new automation file to the automations/ directory.
 * @returns {string} Path to the saved file
 */
export function saveAutomation(name, description, sampleUrls, code) {
  if (!existsSync(AUTOMATIONS_DIR)) mkdirSync(AUTOMATIONS_DIR, { recursive: true });

  const date          = new Date().toISOString().slice(0, 10);
  const indentedCode  = code.split('\n').map(l => '  ' + l).join('\n');

  const content = `export const meta = {
  name:        ${JSON.stringify(name)},
  description: ${JSON.stringify(description)},
  sampleUrls:  ${JSON.stringify(sampleUrls)},
  createdAt:   ${JSON.stringify(date)},
};

/** @param {import('playwright').Page} page */
export async function run(page, ctx) {
${indentedCode}
}
`;

  const filePath = path.join(AUTOMATIONS_DIR, `${name}.mjs`);
  writeFileSync(filePath, content);
  return filePath;
}
