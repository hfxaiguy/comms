/** Site descriptor passed to `ensureLoggedIn` — detects the LinkedIn feed/home pages as the logged-in state. */
export const LINKEDIN = {
  name:       'LinkedIn',
  url:        'https://www.linkedin.com',
  isLoggedIn: u => ['/feed', '/mynetwork', '/jobs'].some(s => u.toString().includes(s)),
};

/**
 * Scores how well a LinkedIn result snippet matches the local profile.
 * Counts keyword hits from companies, professions, notes, and interests.
 */
function scoreMatch(label, profile) {
  const haystack = label.toLowerCase();
  const keywords = [
    ...profile.companies.map(c => c.text),
    ...profile.professions.map(p => p.text),
    ...profile.notes.map(n => n.text),
    ...profile.interests.map(i => i.text),
  ].join(' ').toLowerCase().match(/\b\w{3,}\b/g) ?? [];

  return keywords.filter(w => haystack.includes(w)).length;
}

/** Returns the first LinkedIn URL found in the profile's socials or websites, or null. */
export function getLinkedInUrl(profile) {
  return profile.socials.find(s => s.url.includes('linkedin.com'))?.url
      ?? profile.websites.find(w => w.url.includes('linkedin.com'))?.url
      ?? null;
}

/**
 * Visits a LinkedIn profile page and returns the connection status.
 * @returns {'connected' | 'pending' | 'not connected' | 'unknown'}
 */
export async function checkConnectionStatus(page, profileUrl) {
  await page.goto(profileUrl, { waitUntil: 'domcontentloaded' });
  // Wait for the action bar to appear before reading button state
  await page.waitForSelector('main', { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(2500);

  return page.evaluate(() => {
    // Degree badge — most reliable signal when present
    const degreeSpans = [...document.querySelectorAll('span')]
      .map(s => s.textContent.trim());
    if (degreeSpans.includes('1st')) return 'connected';

    // aria-label attributes are more stable than visible button text (which may include icon labels)
    const ariaLabels = [...document.querySelectorAll('button[aria-label]')]
      .map(b => b.getAttribute('aria-label').toLowerCase());

    if (ariaLabels.some(l => l.includes('pending') || l.includes('withdraw'))) return 'pending';
    if (ariaLabels.some(l => l.startsWith('message ')))                        return 'connected';
    if (ariaLabels.some(l => l.startsWith('connect ')))                        return 'not connected';
    if (ariaLabels.some(l => l.startsWith('follow ')))                         return 'not connected';

    // Fallback: exact match on trimmed innerText (ignores any icon text inside the button)
    const texts = [...document.querySelectorAll('button')]
      .map(b => b.innerText.trim().split('\n')[0].trim().toLowerCase());

    if (texts.some(t => t === 'pending' || t === 'withdraw'))  return 'pending';
    if (texts.some(t => t === 'message'))                      return 'connected';
    if (texts.some(t => t === 'connect'))                      return 'not connected';
    if (texts.some(t => t === 'follow'))                       return 'not connected';

    return 'unknown';
  });
}

/**
 * Searches LinkedIn for a person by name, extracts up to 5 profile results,
 * and sorts them by how well their snippet matches the local profile data.
 */
export async function searchProfiles(page, profile) {
  const query = [profile.firstName, profile.lastName].filter(Boolean).join(' ');
  const url   = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(query)}`;

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  const results = await page.evaluate(() => {
    const seen = new Set();
    const out  = [];

    for (const link of document.querySelectorAll('a[href*="/in/"]')) {
      const href = link.href.split('?')[0];
      if (seen.has(href) || !/\/in\/[^/]+\/?$/.test(href)) continue;
      seen.add(href);

      const card  = link.closest('li') ?? link.parentElement;
      const lines = (card?.innerText ?? link.innerText ?? '')
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean)
        .slice(0, 3);

      out.push({ url: href, label: lines.join(' · ') });
      if (out.length >= 5) break;
    }

    return out;
  });

  return results
    .map(r => ({ ...r, score: scoreMatch(r.label, profile) }))
    .sort((a, b) => b.score - a.score);
}
