import { InferenceClient } from '@huggingface/inference';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '..', 'hf.config.json');

function loadConfig() {
  if (!existsSync(CONFIG_PATH)) throw new Error('Missing hf.config.json');
  return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
}

export async function callAgent(prompt, { max, retries = 3, baseDelay = 2000 } = {}) {
  const cfg    = loadConfig();
  const client = new InferenceClient(cfg.token);

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await client.chatCompletion({
        model:      cfg.model    ?? 'moonshotai/Kimi-K2-5',
        ...(cfg.provider ? { provider: cfg.provider } : {}),
        messages:   [{ role: 'user', content: prompt }],
        max_tokens: Math.max(512, cfg.max_tokens ?? 512),
      });
      const text = response.choices[0].message.content.trim();
      return max && text.length > max ? text.slice(0, max) : text;
    } catch (err) {
      const status    = err.httpResponse?.status ?? err.status;
      const transient = [429, 502, 503, 504].includes(status);
      if (transient && attempt < retries - 1) {
        await new Promise(r => setTimeout(r, baseDelay * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
}
