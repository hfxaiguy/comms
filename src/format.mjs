// src/format.mjs
//
// Dual-format profile formatter. Used by:
//   - CLI (index.mjs) — "cli" mode, returns formatted text
//   - Tools (tools.mjs) — "json" mode, returns structured data
//
// Usage:
//   import { formatProfile, formatProfiles } from './src/format.mjs';
//   const text = formatProfile(profile, attrs, rels, 'cli');
//   const obj  = formatProfile(profile, attrs, rels, 'json');

/**
 * Parse a profile's attributes into typed groups.
 * Returns an object keyed by attribute type, with parsed data values.
 */
function parseAttrs(attrs) {
  const get = (type) => {
    const a = attrs.filter(x => x.type === type);
    return a.map(x => JSON.parse(x.data));
  };
  const getText = (type) => get(type).filter(v => typeof v === 'string');

  return {
    get,
    getText,
  };
}

/**
 * Format a single profile as a CLI text string or JSON object.
 *
 * @param {object} profile - { id, first_name, last_name, group_name }
 * @param {Array}  attrs   - from getAttributes(profile.id)
 * @param {Array}  rels    - from getRelationships(profile.id)
 * @param {string} format  - 'cli' (default) or 'json'
 * @returns {string|object}
 */
export function formatProfile(profile, attrs, rels, format = 'cli') {
  const { get, getText } = parseAttrs(attrs);

  const name  = [profile.first_name, profile.last_name].filter(Boolean).join(' ') || '(unnamed)';
  const group = profile.group_name || '';

  if (format === 'json') {
    return {
      id: profile.id,
      name,
      group,
      date_added:       getText('date_added')[0] || null,
      connection_level: getText('connection_level')[0] || null,
      met:              getText('met')[0] || null,
      cards:            getText('card'),
      emails:           get('email'),
      phones:           get('phone'),
      websites:         get('website'),
      socials:          get('social'),
      professions:      getText('profession'),
      companies:        getText('company'),
      podcasts:         getText('podcast'),
      interests:        getText('interest'),
      proposals:        getText('proposal'),
      promises:         getText('promise'),
      notes:            getText('note'),
      messages:         get('message').map(m => ({
        text:         m.text || '',
        date_sent:    m.dateSent || '',
        status:       m.status || '',
        channel:      m.channel || '',
        template:     m.templateName || '',
      })),
      relationships: rels.map(r => ({
        type: r.type,
        name: r.linked_name.trim() || null,
        id:   r.linked_profile_id,
      })),
      // Legacy text-based relationships (unmatched during migration)
      related_to: getText('related_to'),
      with:       getText('with'),
    };
  }

  // CLI format — build lines
  const lines = [];
  lines.push(`\n── ${name}${group ? `  [${group}]` : ''}`);

  const dateAdded       = getText('date_added')[0];
  const connectionLevel = getText('connection_level')[0];
  const met             = getText('met')[0];
  if (dateAdded)       lines.push(`   added      ${dateAdded}`);
  if (connectionLevel) lines.push(`   connection ${connectionLevel}`);
  if (met)             lines.push(`   met        ${met}`);

  for (const c of getText('card'))        lines.push(`   card       ${c}`);
  for (const e of get('email'))           lines.push(`   email      ${e.address}${e.label ? ` (${e.label})` : ''}`);
  for (const p of get('phone'))           lines.push(`   phone      ${p.number}${p.label ? ` (${p.label})` : ''}`);
  for (const w of get('website'))         lines.push(`   website    ${w.url}${w.label ? ` (${w.label})` : ''}`);
  for (const s of get('social'))          lines.push(`   social     ${s.url}${s.label ? ` (${s.label})` : ''}`);
  for (const p of getText('profession'))  lines.push(`   profession ${p}`);
  for (const c of getText('company'))     lines.push(`   company    ${c}`);
  for (const p of getText('podcast'))     lines.push(`   podcast    ${p}`);
  for (const i of getText('interest'))    lines.push(`   interest   ${i}`);

  for (const r of rels) {
    const label = r.type === 'with' ? 'with' : 'related to';
    lines.push(`   ${label.padEnd(12)}${r.linked_name.trim() || `(profile #${r.linked_profile_id})`}`);
  }
  for (const x of getText('related_to')) lines.push(`   related to ${x}`);
  for (const x of getText('with'))       lines.push(`   with       ${x}`);

  for (const p of getText('proposal'))    lines.push(`   propose    ${p}`);
  for (const p of getText('promise'))     lines.push(`   promise    ${p}`);
  for (const n of getText('note'))        lines.push(`   note       ${n}`);

  for (const m of get('message')) {
    const meta = [m.dateSent, m.status, m.channel].filter(Boolean).join(' · ');
    lines.push(`   message    ${m.text || '(empty)'}${meta ? `  [${meta}]` : ''}`);
  }

  return lines.join('\n');
}

/**
 * Format multiple profiles.
 *
 * @param {Array}  profiles - from getProfiles()
 * @param {string} format   - 'cli' (default) or 'json'
 * @param {function} getAttrs - (profileId) => attrs array
 * @param {function} getRels  - (profileId) => relationships array
 * @returns {string|Array}
 */
export function formatProfiles(profiles, format = 'cli', getAttrs, getRels) {
  if (format === 'json') {
    return profiles.map(p => {
      const attrs = getAttrs ? getAttrs(p.id) : [];
      const rels  = getRels  ? getRels(p.id)  : [];
      return formatProfile(p, attrs, rels, 'json');
    });
  }

  // CLI format
  const parts = profiles.map(p => {
    const attrs = getAttrs ? getAttrs(p.id) : [];
    const rels  = getRels  ? getRels(p.id)  : [];
    return formatProfile(p, attrs, rels, 'cli');
  });
  return parts.join('\n') + '\n';
}
