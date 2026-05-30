import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { InferenceClient } from '@huggingface/inference';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '..', '..', 'hf.config.json');
const MAX_HTML    = 80_000;

const SYSTEM = `You write Playwright browser automation code.
Always return JSON with two fields:
- "explanation": one sentence describing what the code does or what changed
- "code": the async function body only (no wrapper, no export) — it receives (page, ctx) where ctx.url is the target URL`;

function stripFunctionWrapper(code) {
  // If Kimi includes the async function wrapper, strip it
  const match = code.match(/async\s+function\s*\w*\s*\([^)]*\)\s*\{([\s\S]*)\}\s*$/);
  if (match) return match[1].trim();
  const arrowMatch = code.match(/async\s*\([^)]*\)\s*=>\s*\{([\s\S]*)\}\s*$/);
  if (arrowMatch) return arrowMatch[1].trim();
  return code;
}

function parseResponse(text) {
  try {
    const parsed = JSON.parse(text);
    return { explanation: parsed.explanation ?? '', code: stripFunctionWrapper(parsed.code ?? '') };
  } catch {
    throw new Error(`Could not parse model response as JSON:\n${text.slice(0, 300)}`);
  }
}

/**
 * Asks Kimi to generate a Playwright function body for the described task.
 * @returns {{ explanation: string, code: string }}
 */
export async function generateCode(description, sampleUrl) {
  const { token, model = 'moonshotai/Kimi-K2.6' } = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  const client = new InferenceClient(token);

  const prompt = `Task: ${description}
Sample URL: ${sampleUrl}

Write the body of this function:
  async function run(page, ctx) { <body here> }

Use ctx.url as the target. Return structured data or a boolean. Return JSON.`;

  const response = await client.chatCompletion({
    model,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user',   content: prompt },
    ],
    max_tokens: 4096,
    response_format: { type: 'json_object' },
  });

  return parseResponse(response.choices[0].message.content);
}

/**
 * Asks Kimi to revise code given the previous result, user feedback, and the page HTML.
 * @returns {{ explanation: string, code: string }}
 */
export async function reviseCode(currentCode, result, feedback, pageHtml) {
  const { token, model = 'moonshotai/Kimi-K2.6' } = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  const client = new InferenceClient(token);

  const html = pageHtml.length > MAX_HTML
    ? pageHtml.slice(0, MAX_HTML) + '\n<!-- HTML truncated -->'
    : pageHtml;

  const prompt = `Current function body:
\`\`\`js
${currentCode}
\`\`\`

What it returned: ${JSON.stringify(result)}

User feedback: ${feedback}

Page HTML:
\`\`\`html
${html}
\`\`\`

Revise the function body to fix the issue. Return JSON.`;

  const response = await client.chatCompletion({
    model,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user',   content: prompt },
    ],
    max_tokens: 4096,
    response_format: { type: 'json_object' },
  });

  return parseResponse(response.choices[0].message.content);
}
