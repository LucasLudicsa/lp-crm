import type { Page } from "playwright";
import { area } from "../config.js";
import { SEL } from "../selectors.js";
import { dismissConsent } from "../browser/context.js";
import { absoluteMapsUrl, extractPlaceCid } from "../maps-parse.js";
import { politeSleep, sleep } from "../util.js";
import { log } from "../logger.js";
import {
  bumpCellAttempt,
  insertDiscovered,
  markCell,
  upsertCell,
  type CellRow,
} from "../db.js";
import { cellId, subdivide } from "../grid.js";

function searchUrl(keyword: string, lat: number, lng: number): string {
  return `https://www.google.com/maps/search/${encodeURIComponent(keyword)}/@${lat},${lng},${area.searchZoom}z?hl=${area.hl}&gl=${area.gl}`;
}

interface CardRef {
  href: string;
  name: string | null;
}

async function collectCards(page: Page): Promise<CardRef[]> {
  return page.$$eval(SEL.resultLink, (els) =>
    els.map((el) => ({
      href: (el as HTMLAnchorElement).href,
      name: el.getAttribute("aria-label"),
    })),
  );
}

async function scrollFeed(page: Page): Promise<CardRef[]> {
  await page.waitForSelector(SEL.feed, { timeout: 20_000 }).catch(() => {});

  let stable = 0;
  let prev = -1;
  let cards: CardRef[] = [];

  for (let i = 0; i < 40 && stable < 3; i++) {
    cards = await collectCards(page);
    if (cards.length === prev) stable++;
    else stable = 0;
    prev = cards.length;

    if (cards.length >= area.maxResultsPerCell) break;
    if (await page.locator(SEL.feedEndSentinel).count().catch(() => 0)) break;

    await page
      .$eval(SEL.feed, (el) => el.scrollBy(0, el.scrollHeight))
      .catch(() => {});
    await sleep(900 + Math.random() * 900);
  }
  return cards;
}

/** Run one search cell: navigate, scroll, persist discovered businesses. */
export async function runCell(page: Page, cell: CellRow): Promise<void> {
  const url = searchUrl(cell.keyword, cell.lat, cell.lng);
  log.info("search cell", { id: cell.id, keyword: cell.keyword, depth: cell.depth });

  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await dismissConsent(page);

    // Maps renders the feed / place panel after `domcontentloaded` — wait for
    // whichever appears before deciding which branch we're on.
    await Promise.race([
      page.waitForSelector(SEL.resultLink, { timeout: 30_000 }),
      page.waitForSelector(SEL.feed, { timeout: 30_000 }),
      page.waitForSelector(SEL.detailName, { timeout: 30_000 }),
    ]).catch(() => {});

    // A single result opens the detail panel directly (no feed).
    const hasResults =
      (await page.locator(SEL.feed).count().catch(() => 0)) ||
      (await page.locator(SEL.resultLink).count().catch(() => 0));
    let cards: CardRef[] = [];
    if (hasResults) {
      cards = await scrollFeed(page);
    } else if (await page.locator(SEL.detailName).count().catch(() => 0)) {
      cards = [{ href: page.url(), name: await page.locator(SEL.detailName).first().textContent() }];
    }

    let inserted = 0;
    for (const card of cards) {
      const cid = extractPlaceCid(card.href);
      if (!cid) continue;
      const added = insertDiscovered({
        place_cid: cid,
        name: card.name?.trim() || null,
        category_query: cell.keyword,
        district: cell.district,
        place_url: absoluteMapsUrl(card.href),
        lat: null,
        lng: null,
      });
      if (added) inserted++;
    }

    const capped = cards.length >= area.maxResultsPerCell && cell.depth < area.maxSubdivideDepth;
    if (capped) {
      for (const child of subdivide({ lat: cell.lat, lng: cell.lng }, cell.depth, area.cellKm)) {
        const id = cellId(cell.district, cell.keyword, child, cell.depth + 1);
        upsertCell({
          id,
          district: cell.district,
          category: cell.category,
          keyword: cell.keyword,
          lat: child.lat,
          lng: child.lng,
          depth: cell.depth + 1,
        });
      }
      markCell(cell.id, "capped", cards.length);
      log.info("cell capped -> subdivided", { id: cell.id, found: cards.length });
    } else {
      markCell(cell.id, "done", cards.length);
      log.info("cell done", { id: cell.id, cards: cards.length, newBusinesses: inserted });
    }
  } catch (err) {
    bumpCellAttempt(cell.id);
    log.warn("cell failed", { id: cell.id, err: (err as Error).message });
    throw err;
  } finally {
    await politeSleep(0.5, 1.5);
  }
}
