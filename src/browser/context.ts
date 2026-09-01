import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Browser, BrowserContext, Page } from "playwright";
import { area, env } from "../config.js";
import { SEL } from "../selectors.js";
import { log } from "../logger.js";

let stealthReady = false;
function ensureStealth() {
  if (stealthReady) return;
  // playwright-extra shares puppeteer-extra's plugin interface
  (chromium as unknown as { use: (p: unknown) => void }).use(StealthPlugin());
  stealthReady = true;
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export interface Session {
  browser: Browser;
  context: BrowserContext;
  newPage: () => Promise<Page>;
  close: () => Promise<void>;
}

export async function openSession(): Promise<Session> {
  ensureStealth();

  const browser = await chromium.launch({
    headless: !env.headful,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-dev-shm-usage",
    ],
    proxy: env.proxyUrl ? { server: env.proxyUrl } : undefined,
  });

  const context = await browser.newContext({
    locale: area.hl,
    timezoneId: "America/Sao_Paulo",
    geolocation: area.geolocation,
    permissions: ["geolocation"],
    viewport: { width: 1366, height: 900 },
    userAgent: UA,
  });
  context.setDefaultTimeout(45_000);
  context.setDefaultNavigationTimeout(60_000);

  return {
    browser,
    context,
    newPage: () => context.newPage(),
    close: async () => {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    },
  };
}

/** Dismiss the Google consent interstitial if present. Safe to call on every page. */
export async function dismissConsent(page: Page): Promise<void> {
  if (!/consent\.google\./.test(page.url()) && !(await page.locator(SEL.consentButtons[0]!).count().catch(() => 0))) {
    return;
  }
  for (const sel of SEL.consentButtons) {
    const btn = page.locator(sel).first();
    if (await btn.count().catch(() => 0)) {
      await btn.click({ timeout: 4_000 }).catch(() => {});
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      log.debug("dismissed consent", { sel });
      return;
    }
  }
}
