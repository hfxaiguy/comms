import { createInterface } from 'readline';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { InferenceClient } from '@huggingface/inference';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '..', 'hf.config.json');

const SCHEMA = `{
  "firstName": "",
  "lastName": "",
  "emails":      [{ "address": "", "label": "" }],
  "phones":      [{ "number": "",  "label": "" }],
  "websites":    [{ "url": "",     "label": "" }],
  "socials":     [{ "url": "",     "label": "" }],
  "professions": [],
  "companies":   [],
  "interests":   [],
  "notes":       []
}`;

const SYSTEM = 'You extract structured person data from natural language. Output only valid JSON, no explanation.';

const PROMPT = `Extract person information from the description and return ONLY a JSON object matching this structure:
${SCHEMA}
Rules:
- professions, companies, interests, notes are plain string arrays
- emails and phones include a label only if one is mentioned (e.g. "mobile", "work")
- socials: LinkedIn, Twitter/X, Instagram, etc.
- websites: other URLs
- Put anything that doesn't fit elsewhere into notes
- Use empty arrays or strings for missing fields — never omit a field`;

/** Extracts the first valid JSON object from a model response, tolerating markdown fences. */
function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try { return JSON.parse(fenced[1].trim()); } catch {}
  }
  const start = text.indexOf('{');
  const end   = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch {}
  }
  throw new Error(`Could not parse JSON from model response:\n${text.slice(0, 300)}`);
}

/** Prompts the user to type a free-form description, ending with a blank line. */
export async function readDescription() {
  console.log('Describe the person — press Enter on an empty line when done:\n');

  const rl    = createInterface({ input: process.stdin, output: process.stdout });
  const lines = [];

  return new Promise(resolve => {
    rl.on('line', line => {
      if (!line.trim() && lines.length) {
        rl.close();
        resolve(lines.join('\n').trim());
      } else {
        lines.push(line);
      }
    });
    rl.on('close', () => resolve(lines.join('\n').trim()));
  });
}

/** Sends `description` to Kimi and returns structured person fields as a plain object. */
export async function parseDescription(description) {
  const { token, model = 'moonshotai/Kimi-K2.6' } = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  const client = new InferenceClient(token);

  process.stdout.write('Analyzing... ');

  const response = await client.chatCompletion({
    model,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user',   content: `${PROMPT}\n\nDescription:\n${description}` },
    ],
    max_tokens: 512,
    response_format: { type: 'json_object' },
  });

  console.log('done.\n');
  return extractJson(response.choices[0].message.content);
}

/** Prints a structured summary of `fields` to stdout for user review before saving. */
export function previewPerson(fields) {
  const name = [fields.firstName, fields.lastName].filter(Boolean).join(' ');
  console.log(`── ${name || '(no name)'}`);

  for (const p of fields.professions ?? []) console.log(`   profession  ${p}`);
  for (const c of fields.companies   ?? []) console.log(`   company     ${c}`);
  for (const e of fields.emails      ?? []) console.log(`   email       ${e.address}${e.label ? ` (${e.label})` : ''}`);
  for (const p of fields.phones      ?? []) console.log(`   phone       ${p.number}${p.label ? ` (${p.label})` : ''}`);
  for (const w of fields.websites    ?? []) console.log(`   website     ${w.url}${w.label ? ` (${w.label})` : ''}`);
  for (const s of fields.socials     ?? []) console.log(`   social      ${s.url}${s.label ? ` (${s.label})` : ''}`);
  for (const i of fields.interests   ?? []) console.log(`   interest    ${i}`);
  for (const n of fields.notes       ?? []) console.log(`   note        ${n}`);

  console.log();
}
