import OpenAI from 'openai';

const HF_BASE_URL = process.env.HF_BASE_URL   ?? 'https://router.huggingface.co/v1/';
const KIMI_MODEL  = process.env.KIMI_MODEL     ?? 'moonshotai/Kimi-K2-Instruct';
const HF_API_KEY  = process.env.HF_TOKEN       ?? process.env.HUGGING_FACE_HUB_TOKEN ?? '[REDACTED]';

const client = new OpenAI({ baseURL: HF_BASE_URL, apiKey: HF_API_KEY });

// ── System prompt ──────────────────────────────────────────────────────────────

const SYSTEM = `\
You are a contacts management assistant. You have access to a SQLite contacts database.

Every response MUST be a single valid JSON object with EXACTLY this shape — no prose, no fences:

{
  "reasoning":   string,         // your analysis
  "code":        string | null,  // Node.js code to execute; null for pure conversation
  "result_text": string | null,  // the human-readable answer or summary
  "done":        boolean,        // true = task complete, show the user your result
  "next_prompt": string | null   // if done=false: self-prompt for next iteration; null when done=true
}

─── Database schema ──────────────────────────────────────────────────────────
Table: profiles       — id INTEGER PRIMARY KEY, created_at TEXT
Table: attributes     — id, profile_id (FK→profiles), type TEXT, data TEXT, sort_order INTEGER

Attribute types and data formats (data is always JSON-stringified):
  first_name, last_name    → JSON string, e.g. "\"Anton\""
  group                    → JSON string, e.g. "\"Volta Builders\""
  company, profession      → JSON string
  note, proposal, promise  → JSON string
  interest, podcast        → JSON string
  session                  → JSON string  (conference/event session title)
  connection_level, met    → JSON string
  date_added               → JSON string (YYYY-MM-DD)
  email                    → JSON object: { address, label }
  phone                    → JSON object: { number, label }
  website                  → JSON object: { url, label }
  social                   → JSON object: { url, label, status, lastChecked }
  message                  → JSON object: { channel, dateSent, text, status }

─── Code execution context ────────────────────────────────────────────────────
These are always available in your code:

  profiles      — array of pre-loaded profile objects:
                  { id, firstName, lastName, group, attrs: [{id, type, data}] }
                  Parse attr values with JSON.parse(attr.data)

  db            — better-sqlite3 Database instance (synchronous)
                  db.prepare('SELECT ...').all()   → array of rows
                  db.prepare('SELECT ...').get()   → single row or undefined
                  db.prepare('SELECT ...').run()   → { changes, lastInsertRowid }

  getAttributes(profileId)                → [{id, type, data, sort_order}]
  addAttribute(profileId, type, data)     → inserts a new attribute
  updateAttribute(attrId, data)           → updates attribute data
  deleteAttribute(attrId)                 → deletes an attribute
  createProfile(attrs)                    → creates profile, returns id

  collect(value)    — emit the primary result back to the UI

─── Code style rules ─────────────────────────────────────────────────────────
• Write plain statements — NOT wrapped in any function or IIFE
  The runtime wraps your code in: (async () => { YOUR CODE })()
• Top-level await works
• Call collect(value) to return a result — it's not captured from return
• db operations are synchronous (no await needed)
• Always use optional chaining (?.) when accessing properties that may be absent

─── Iteration rules ──────────────────────────────────────────────────────────
• done=false requires a non-null next_prompt
• Only set done=true when you have seen the output and confirmed it is correct
• If you are writing an automation (reusable script), ensure the final code
  includes everything needed to run standalone — don't rely on previous iterations
• result_text should always summarise what you found or did in plain language`;

// ── Context builder ────────────────────────────────────────────────────────────

export function buildUserMessage(history, iterations, instruction, iterationsLeft) {
  const parts = [];

  if (history.length > 0) {
    parts.push('## Conversation history\n');
    for (const turn of history) {
      if (turn.role === 'user') {
        parts.push(`[user] ${turn.text}\n`);
      } else {
        parts.push(`[kimi] ${turn.result_text ?? '(no text)'}`);
        if (turn.code)   parts.push('code was run: ' + turn.code.slice(0, 200) + (turn.code.length > 200 ? '...' : ''));
        if (turn.output != null) parts.push('output: ' + JSON.stringify(turn.output).slice(0, 300));
        if (turn.error)  parts.push('error: ' + turn.error);
        parts.push('');
      }
    }
  }

  if (iterations.length > 0) {
    parts.push('## Current working iterations\n');
    for (const [i, iter] of iterations.entries()) {
      parts.push(`--- Iteration ${i + 1} [${iter.source}] ---`);
      parts.push('Instruction: ' + iter.instruction);
      parts.push('Reasoning: '   + iter.reasoning);
      if (iter.code) {
        const numbered = iter.code.split('\n')
          .map((line, i) => `${String(i + 1).padStart(3)} | ${line}`)
          .join('\n');
        parts.push('Code:\n```\n' + numbered + '\n```');
      }
      if (iter.error)          parts.push('⚠ ERROR: ' + iter.error);
      else if (iter.output != null) parts.push('Output: ' + JSON.stringify(iter.output).slice(0, 1000));
      parts.push('');
    }
  }

  parts.push('## Current instruction\n' + instruction);
  parts.push(`\nIterations left this round: ${iterationsLeft}`);
  if (iterationsLeft === 1) parts.push('(This is your last iteration — set done=true.)');

  return parts.join('\n');
}

// ── JSON extraction ────────────────────────────────────────────────────────────

function extractJSON(text) {
  try { return JSON.parse(text); } catch { /* fall through */ }

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try { return JSON.parse(fenced[1].trim()); } catch { /* fall through */ }
  }

  const start = text.indexOf('{');
  const end   = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch { /* fall through */ }
  }

  throw new Error(`Could not extract JSON from Kimi response:\n${text.slice(0, 400)}`);
}

// ── Public API ─────────────────────────────────────────────────────────────────

const TRANSIENT_RETRY_DELAYS_MS = [2000, 6000, 18000];

export async function callKimi(history, iterations, instruction, iterationsLeft, signal) {
  const userMessage = buildUserMessage(history, iterations, instruction, iterationsLeft);
  let lastError;

  for (let attempt = 0; attempt <= TRANSIENT_RETRY_DELAYS_MS.length; attempt++) {
    if (signal?.aborted) throw new Error('Kimi call aborted');
    if (attempt > 0) {
      await new Promise(res => setTimeout(res, TRANSIENT_RETRY_DELAYS_MS[attempt - 1]));
    }

    let rawContent = '';
    try {
      const response = await client.chat.completions.create({
        model:       KIMI_MODEL,
        messages:    [
          { role: 'system', content: SYSTEM      },
          { role: 'user',   content: userMessage },
        ],
        temperature: 0.1,
        max_tokens:  8192,
      }, { signal });

      rawContent = response.choices[0]?.message?.content ?? '';
      if (!rawContent.trim()) { const e = new Error('empty response'); e.status = 503; throw e; }

      return extractJSON(rawContent);
    } catch (e) {
      if (e.name === 'AbortError' || signal?.aborted) throw e;
      if ((e.status === 502 || e.status === 503 || e.status === 504) && attempt < TRANSIENT_RETRY_DELAYS_MS.length) {
        lastError = e;
        continue;
      }
      throw e;
    }
  }
}
