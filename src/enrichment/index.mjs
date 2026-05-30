import { arrowSelect } from '../prompt.mjs';
import { launchBrowser, ensureLoggedIn } from './browser.mjs';
import { LINKEDIN, searchProfiles, checkConnectionStatus, getLinkedInUrl } from './linkedin.mjs';

/** Returns profiles that have no LinkedIn entry (URL or a 'LinkedIn'-labelled social row) in socials or websites. */
export function missingLinkedIn(profiles) {
  const hasLinkedIn = e => e.url.includes('linkedin.com') || e.label?.toLowerCase() === 'linkedin';
  return profiles.filter(p =>
    !p.websites.some(hasLinkedIn) &&
    !p.socials.some(hasLinkedIn)
  );
}

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Returns profiles whose LinkedIn connection status should be rechecked.
 * Skips profiles that are already connected, or were checked within the last 7 days.
 */
export function needsStatusCheck(profiles) {
  return profiles.filter(p => {
    const url = getLinkedInUrl(p);
    if (!url) return false;

    const social = p.socials.find(s => s.url.includes('linkedin.com'))
                ?? p.websites.find(w => w.url.includes('linkedin.com'));

    if (social?.status === 'connected') return false;
    if (!social?.lastChecked) return true;

    return (Date.now() - new Date(social.lastChecked)) >= ONE_WEEK_MS;
  });
}

/** Returns up to 4 display lines for a profile: name, then profession / company / note. */
function personContext(profile) {
  const name = [profile.firstName, profile.lastName].filter(Boolean).join(' ');
  const candidates = [
    profile.professions[0]?.text,
    profile.companies[0]?.text,
    profile.notes[0]?.text,
  ].filter(Boolean);
  return [name, ...candidates].slice(0, 4);
}

/** Iterates `profiles`, searches LinkedIn for each, and calls `onSave(profile, url)` when the user picks a result. */
async function findPhase(page, profiles, onSave) {
  for (const profile of profiles) {
    const ctx = personContext(profile);
    console.log(`\n── ${ctx[0]}`);
    for (const line of ctx.slice(1)) console.log(`   ${line}`);

    const hasLastName = !!profile.lastName.trim();
    const hasCompany  = profile.companies.length > 0;
    if (!hasLastName && !hasCompany) {
      console.log('\nFirst name only and no company — skipping (too ambiguous to search).');
      continue;
    }

    process.stdout.write('\nSearching... ');
    const results = await searchProfiles(page, profile);

    if (!results.length) {
      console.log('no results.\n');
      const choice = await arrowSelect(['Skip', 'Skip forever  (marks as no LinkedIn profile)']);
      if (choice === 1) {
        await onSave(profile, 'n/a');
        console.log('Marked as no LinkedIn profile.\n');
      }
      continue;
    }

    console.log(`${results.length} result(s).\n`);

    const cols   = process.stdout.columns || 80;
    const maxLen = cols - 3;
    const options = [
      ...results.map(r => r.label.length > maxLen ? r.label.slice(0, maxLen - 3) + '...' : r.label),
      'Skip',
      'Skip forever  (marks as no LinkedIn profile)',
    ];

    const idx = await arrowSelect(options);
    const len = options.length;

    if (idx === len - 1) {
      await onSave(profile, 'n/a');
      console.log('Marked as no LinkedIn profile.\n');
      continue;
    }
    if (idx === len - 2) {
      console.log('Skipped.\n');
      continue;
    }

    await onSave(profile, results[idx].url);
    console.log(`Saved: ${results[idx].url}\n`);
  }
}

/** Visits each profile's LinkedIn URL, reads the connection status, and calls `onStatus(profile, url, status)`. */
async function statusPhase(page, profiles, onStatus) {
  for (const profile of profiles) {
    const url  = getLinkedInUrl(profile);
    const name = [profile.firstName, profile.lastName].filter(Boolean).join(' ');

    process.stdout.write(`Checking ${name}... `);
    const status = await checkConnectionStatus(page, url);
    console.log(status);

    await onStatus(profile, url, status);
  }
}

/** Opens Chromium, logs into LinkedIn, checks one profile's connection status, then calls `onStatus`. */
export async function checkOneStatus(profile, onStatus) {
  const url = getLinkedInUrl(profile);
  if (!url || url === 'n/a') throw new Error(`No LinkedIn URL on record for "${profile.firstName}".`);

  const context = await launchBrowser();
  const page    = context.pages()[0] ?? await context.newPage();

  try {
    await ensureLoggedIn(page, LINKEDIN);
    const name   = [profile.firstName, profile.lastName].filter(Boolean).join(' ');
    process.stdout.write(`Checking ${name}... `);
    const status = await checkConnectionStatus(page, url);
    console.log(status);
    await onStatus(profile, url, status);
  } finally {
    await context.close();
  }
}

/**
 * Opens Chromium, logs into LinkedIn, then runs two sequential phases:
 * 1. Find LinkedIn profiles for `toFind` (user picks from results).
 * 2. Check connection status for `toCheck` (automated, writes to sheet).
 */
export async function runEnrichment({ toFind, toCheck, onSave, onStatus }) {
  const context = await launchBrowser();
  const page    = context.pages()[0] ?? await context.newPage();

  try {
    await ensureLoggedIn(page, LINKEDIN);

    if (toFind.length) {
      console.log('\n── Finding LinkedIn profiles ──\n');
      await findPhase(page, toFind, onSave);
    }

    if (toCheck.length) {
      console.log('\n── Checking connection status ──\n');
      await statusPhase(page, toCheck, onStatus);
    }
  } finally {
    await context.close();
  }

  console.log('\nDone.');
}
