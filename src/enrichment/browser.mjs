import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '..', '..', 'hf.config.json');
const DEFAULT_BROWSER_DATA = path.join(os.homedir(), '.config', 'chromium');
const DEFAULT_BROWSER_BIN  = '/usr/bin/chromium';

/** Returns browser launch config, preferring `browserUserDataDir` / `browserExecutable` from hf.config.json. */
function getBrowserConfig() {
  if (existsSync(CONFIG_PATH)) {
    const cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    return {
      userDataDir:    cfg.browserUserDataDir ?? DEFAULT_BROWSER_DATA,
      executablePath: cfg.browserExecutable  ?? DEFAULT_BROWSER_BIN,
    };
  }
  return { userDataDir: DEFAULT_BROWSER_DATA, executablePath: DEFAULT_BROWSER_BIN };
}

/** Launches Chromium with the user's persistent profile. Throws if the browser is already running. */
export async function launchBrowser() {
  const { userDataDir, executablePath } = getBrowserConfig();
  try {
    return await chromium.launchPersistentContext(userDataDir, {
      executablePath,
      headless: false,
      viewport: null,
    });
  } catch (err) {
    throw new Error(
      `Could not launch Chromium — make sure it is not already running.\n${err.message}`
    );
  }
}

/**
 * Navigates to `site.url` and waits for the user to log in if not already authenticated.
 * @param {{ name: string, url: string, isLoggedIn: (url: string) => boolean }} site
 */
export async function ensureLoggedIn(page, site) {
  await page.goto(site.url, { waitUntil: 'domcontentloaded' });

  if (site.isLoggedIn(page.url())) return;

  console.log(`\nSign in to ${site.name} in the browser window, then come back here...`);
  await page.waitForURL(site.isLoggedIn, { timeout: 300_000 });
  console.log('Logged in.\n');
}
