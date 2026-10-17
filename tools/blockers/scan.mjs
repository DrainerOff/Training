// Opens the app in Chromium (iPhone viewport), walks its screens — including the boot
// diagnostic screen and the temporary-mode banner — and reports elements that one of the
// given element-hiding selectors would hide.
import { chromium, devices } from '@playwright/test';
import { startPages, APP } from '../../tests/helpers/pages-server.js';
import { matchSelectors, walkScreens, walkBootScreens } from './screens.js';

// Selectors that must match, so a scan that silently checks nothing can't pass.
const SENTINELS = ['.tabbar', '.dock', '.diag h1', '.temp-mode'];

export async function scanScreens(selectors) {
  selectors = [...SENTINELS, ...selectors];
  const pages = await startPages();
  pages.publish(APP, 'scan');
  const browser = await chromium.launch();
  const found = new Map();
  const visit = (page) => async (screen) => {
    for (const hit of await matchSelectors(page, selectors)) {
      if (!found.has(hit.selector)) found.set(hit.selector, { ...hit, screen });
    }
  };
  try {
    const options = { ...devices['iPhone 13'], locale: 'ru-RU', timezoneId: 'Europe/Moscow' };
    let ctx = await browser.newContext(options);
    let page = await ctx.newPage();
    await walkScreens(page, pages.url, visit(page));
    await ctx.close();
    ctx = await browser.newContext(options);
    page = await ctx.newPage();
    await walkBootScreens(page, pages.url, visit(page));
    await ctx.close();
  } finally {
    await browser.close();
    await pages.close();
  }
  const missing = SENTINELS.filter((s) => !found.has(s));
  if (missing.length) throw new Error(`Screen scan is broken: ${missing.join(', ')} never matched`);
  return [...found.values()].filter((hit) => !SENTINELS.includes(hit.selector));
}
