import { InferenceClient } from '@huggingface/inference';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '..', 'hf.config.json');

const MEDIA_TYPES  = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
const MAX_LONG_SIDE = 1500;

/** Resizes the image to fit within 1500px on the longest side and returns a JPEG buffer. */
async function prepareImage(imagePath) {
  const img      = sharp(imagePath);
  const { width, height } = await img.metadata();
  const longest  = Math.max(width, height);

  if (longest <= MAX_LONG_SIDE) {
    return { buffer: readFileSync(imagePath), mediaType: MEDIA_TYPES[path.extname(imagePath).slice(1).toLowerCase()] ?? 'image/jpeg' };
  }

  const scale  = MAX_LONG_SIDE / longest;
  const buffer = await img
    .resize(Math.round(width * scale), Math.round(height * scale))
    .jpeg({ quality: 90 })
    .toBuffer();

  console.log(`  (resized from ${width}x${height} → ${Math.round(width * scale)}x${Math.round(height * scale)})`);
  return { buffer, mediaType: 'image/jpeg' };
}

/** Returns the parsed hf.config.json, throwing a helpful error if the file is missing. */
function loadHfConfig() {
  if (!existsSync(CONFIG_PATH)) {
    throw new Error(
      `Missing hf.config.json at ${CONFIG_PATH}\nCreate it with:\n` +
      `{ "token": "hf_...", "model": "moonshotai/Kimi-VL-A3B-Thinking" }`
    );
  }
  return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
}

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

  throw new Error(`Could not find valid JSON in model response:\n${text.slice(0, 300)}`);
}

const PROMPT = `Extract every piece of text and information visible on this business card image.
Respond with ONLY a JSON object, no explanation, no markdown. Use this exact structure:
{
  "firstName": "",
  "lastName": "",
  "emails": [],
  "phones": [],
  "websites": [],
  "companies": [],
  "professions": [],
  "notes": []
}
Rules:
- Capture ALL text from the card — leave nothing out.
- emails: any email address.
- phones: any phone/fax/mobile number, include the label if present (e.g. "Mobile: +1 555 0100").
- websites: any URL, LinkedIn, social media handle or profile link.
- companies: company or organisation name.
- professions: job title, role, department.
- notes: EVERYTHING else that doesn't fit the above — slogans, addresses, physical locations, pronouns, certifications, QR code URLs, handwritten text, anything unusual. When in doubt, put it in notes rather than discard it.
- Never repeat the same value across fields or within an array. Each piece of information appears exactly once.
- If a field has no data use an empty array or empty string. Never omit a field.`;

/**
 * Sends a business card image to Kimi VL and returns structured contact data as a plain object.
 * Logs token usage and estimated cost to stdout.
 */
export async function extractCardInfo(imagePath) {
  const config    = loadHfConfig();
  const client    = new InferenceClient(config.token);
  const model     = config.model ?? 'moonshotai/Kimi-VL-A3B-Thinking';
  const { buffer, mediaType } = await prepareImage(imagePath);
  const base64 = buffer.toString('base64');

  const response = await client.chatCompletion({
    model,
    messages: [
      {
        role: 'system',
        content: 'You are a structured data extractor. Output only valid JSON with no explanation, no reasoning, no markdown, no extra text.',
      },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${mediaType};base64,${base64}` } },
          { type: 'text', text: PROMPT },
        ],
      },
    ],
    max_tokens: 1024,
    response_format: { type: 'json_object' },
  });

  const usage = response.usage;
  if (usage) {
    const cached    = usage.prompt_tokens_details?.cached_tokens ?? 0;
    const uncached  = usage.prompt_tokens - cached;
    const cost      = (uncached / 1_000_000) * 0.95
                    + (cached   / 1_000_000) * 0.16
                    + (usage.completion_tokens / 1_000_000) * 4.00;
    console.log(`tokens: ${uncached}+${cached}cached in / ${usage.completion_tokens} out — $${cost.toFixed(5)}`);
  }

  const text = response.choices[0].message.content;
  return extractJson(text);
}
