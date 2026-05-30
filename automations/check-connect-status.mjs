export const meta = {
  name:        "check-connect-status",
  description: "Get connection status on LinkedIn",
  sampleUrls:  ["https://www.linkedin.com/in/arielle-nissenblatt/"],
  createdAt:   "2026-05-30",
};

/** @param {import('playwright').Page} page */
export async function run(page, ctx) {
  await page.goto(ctx.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
  
  // Wait briefly for initial render, but don't block on networkidle which can hang on SPAs
  await page.waitForTimeout(2000);
  
  let status = 'unknown';
  let buttonText = null;
  let detectionMethod = null;
  
  // Helper to safely check visibility with short timeout
  async function safeIsVisible(locator, timeout = 2000) {
    try {
      return await locator.first().isVisible({ timeout });
    } catch {
      return false;
    }
  }
  
  // Helper to safely get text content
  async function safeTextContent(locator) {
    try {
      return await locator.first().textContent({ timeout: 2000 }) || '';
    } catch {
      return '';
    }
  }
  
  // Method 1: Check for "Pending" button FIRST - this is the most reliable indicator
  const pendingSelectors = [
    'button:has-text("Pending")',
    'a:has-text("Pending")',
    '[aria-label*="Pending"]',
    'text="Pending"'
  ];
  
  for (const selector of pendingSelectors) {
    try {
      const locator = page.locator(selector);
      if (await safeIsVisible(locator, 2000)) {
        const text = await safeTextContent(locator);
        if (text.toLowerCase().includes('pending')) {
          status = 'pending';
          buttonText = text.trim();
          detectionMethod = 'pending_button';
          break;
        }
      }
    } catch {
      continue;
    }
  }
  
  // Method 2: Check for "1st" connection degree badge near the name
  if (status === 'unknown') {
    const firstDegreeSelectors = [
      'text="1st"',
      'text="· 1st"',
      'p:has-text("1st")',
      'span:has-text("1st")',
      '[class*="1st"]'
    ];
  
    for (const selector of firstDegreeSelectors) {
      try {
        const locator = page.locator(selector);
        if (await safeIsVisible(locator, 2000)) {
          const text = await safeTextContent(locator);
          if (text.includes('1st')) {
            status = 'connected';
            buttonText = '1st';
            detectionMethod = 'degree_badge';
            break;
          }
        }
      } catch {
        continue;
      }
    }
  }
  
  // Method 3: If no 1st badge found, check for "2nd" or "3rd" to determine not connected
  if (status === 'unknown') {
    const otherDegreeSelectors = [
      'text="2nd"',
      'text="· 2nd"',
      'text="3rd"',
      'text="· 3rd"'
    ];
    for (const selector of otherDegreeSelectors) {
      try {
        const locator = page.locator(selector);
        if (await safeIsVisible(locator, 1500)) {
          const text = await safeTextContent(locator);
          status = 'not_connected';
          buttonText = text;
          detectionMethod = 'degree_badge_other';
          break;
        }
      } catch {
        continue;
      }
    }
  }
  
  // Method 4: Click "More" button and check for "Remove connection" in dropdown
  if (status === 'unknown') {
    const moreButtonSelectors = [
      'button:has-text("More")',
      '[aria-label="More"]',
      'button[aria-expanded="false"]:has-text("More")'
    ];
    
    let moreButton = null;
    for (const selector of moreButtonSelectors) {
      try {
        const btn = page.locator(selector).first();
        if (await safeIsVisible(btn, 2000)) {
          moreButton = btn;
          break;
        }
      } catch {
        continue;
      }
    }
    
    if (moreButton) {
      try {
        await moreButton.click({ timeout: 3000 });
        await page.waitForTimeout(800);
        
        // Check dropdown for "Remove connection"
        const removeConnectionSelectors = [
          'text="Remove connection"',
          '[role="menuitem"]:has-text("Remove")',
          'div:has-text("Remove connection")'
        ];
        
        for (const selector of removeConnectionSelectors) {
          try {
            const item = page.locator(selector).first();
            if (await safeIsVisible(item, 2000)) {
              const text = await safeTextContent(item);
              if (text.toLowerCase().includes('remove connection')) {
                status = 'connected';
                buttonText = 'Remove connection';
                detectionMethod = 'dropdown_menu';
                break;
              }
            }
          } catch {
            continue;
          }
        }
        
        // Close dropdown by pressing Escape
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(300);
      } catch {
        // Ignore click errors
      }
    }
  }
  
  // Method 5: Check visible action buttons as fallback
  if (status === 'unknown') {
    const actionSelectors = [
      'button:has-text("Connect")',
      'button:has-text("Pending")',
      'button:has-text("Message")',
      'button:has-text("Follow")',
      'a:has-text("Message")',
      'a:has-text("Pending")'
    ];
    
    for (const selector of actionSelectors) {
      try {
        const btn = page.locator(selector).first();
        if (await safeIsVisible(btn, 1500)) {
          const text = await safeTextContent(btn);
          buttonText = text.trim();
          
          const lowerText = buttonText.toLowerCase();
          if (lowerText.includes('connect') || lowerText.includes('follow')) {
            status = 'not_connected';
          } else if (lowerText.includes('pending')) {
            status = 'pending';
          } else if (lowerText.includes('message')) {
            status = 'connected';
          }
          
          if (status !== 'unknown') {
            detectionMethod = 'action_button';
            break;
          }
        }
      } catch {
        continue;
      }
    }
  }
  
  // Method 6: Check page text content for connection indicators as last resort
  if (status === 'unknown') {
    try {
      const pageText = await page.textContent('body', { timeout: 3000 }).catch(() => '');
      if (pageText.includes('· 1st') || pageText.includes('1st degree')) {
        status = 'connected';
        buttonText = '1st';
        detectionMethod = 'page_text';
      } else if (pageText.includes('· 2nd') || pageText.includes('2nd degree')) {
        status = 'not_connected';
        buttonText = '2nd';
        detectionMethod = 'page_text';
      } else if (pageText.includes('· 3rd') || pageText.includes('3rd degree')) {
        status = 'not_connected';
        buttonText = '3rd';
        detectionMethod = 'page_text';
      }
    } catch {
      // Ignore
    }
  }
  
  return {
    status: status,
    buttonText: buttonText,
    detectionMethod: detectionMethod,
    isConnected: status === 'connected',
    isPending: status === 'pending',
    isNotConnected: status === 'not_connected'
  };
}
