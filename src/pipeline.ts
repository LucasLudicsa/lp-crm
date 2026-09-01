import { area, env, keywordsForCategories, selectDistricts } from "./config.js";
import { cellId, cellsForBbox } from "./grid.js";
import { nextBusinesses, nextPendingCells, stats, upsertCell } from "./db.js";
import { openSession } from "./browser/context.js";
import { runCell } from "./stages/search.js";
import { runDetail } from "./stages/detail.js";
import { politeSleep } from "./util.js";
import { log } from "./logger.js";

export interface ScrapeOptions {
  districts?: string[];
  categories?: string[];
  limitCells?: number;
  limitDetails?: number;
  seedOnly?: boolean;
  skipDetail?: boolean;
}

/** Insert one `cells` row per (district x keyword x grid cell). Idempotent. */
export function seedCells(opts: ScrapeOptions): number {
  const districts = selectDistricts(opts.districts);
  const kw = keywordsForCategories(opts.categories);
  let n = 0;
  for (const d of districts) {
    const cells = cellsForBbox(d.bbox, area.cellKm);
    for (const { category, keyword } of kw) {
      for (const c of cells) {
        upsertCell({
          id: cellId(d.id, keyword, c, 0),
          district: d.id,
          category,
          keyword,
          lat: c.lat,
          lng: c.lng,
          depth: 0,
        });
        n++;
      }
    }
  }
  log.info("seeded cells", { count: n, districts: districts.map((d) => d.id), keywords: kw.length });
  return n;
}

async function runSearchPhase(limit: number): Promise<void> {
  const session = await openSession();
  const page = await session.newPage();
  try {
    let processed = 0;
    while (processed < limit) {
      const batch = nextPendingCells(Math.min(10, limit - processed));
      if (!batch.length) break;
      for (const cell of batch) {
        try {
          await runCell(page, cell);
        } catch {
          /* runCell already logged + bumped attempts */
        }
        processed++;
        await politeSleep(env.searchMinDelay, env.searchMaxDelay);
      }
    }
    log.info("search phase complete", { processed });
  } finally {
    await session.close();
  }
}

async function runDetailPhase(limit: number): Promise<void> {
  const session = await openSession();
  const workers = Math.max(1, env.detailConcurrency);
  const pages = await Promise.all(Array.from({ length: workers }, () => session.newPage()));
  let processed = 0;

  try {
    while (processed < limit) {
      const batch = nextBusinesses(
        "discovered",
        Math.min(workers * 5, limit - processed),
        "detail_attempts",
      );
      if (!batch.length) break;

      // Fan the batch across the page pool.
      const queue = [...batch];
      await Promise.all(
        pages.map(async (page) => {
          for (let biz = queue.shift(); biz; biz = queue.shift()) {
            await runDetail(page, biz);
            processed++;
            await politeSleep(env.detailMinDelay, env.detailMaxDelay);
          }
        }),
      );
    }
    log.info("detail phase complete", { processed, workers });
  } finally {
    await session.close();
  }
}

export async function scrape(opts: ScrapeOptions): Promise<void> {
  seedCells(opts);
  if (opts.seedOnly) return;

  await runSearchPhase(opts.limitCells ?? Number.MAX_SAFE_INTEGER);
  if (!opts.skipDetail) {
    await runDetailPhase(opts.limitDetails ?? Number.MAX_SAFE_INTEGER);
  }
  log.info("scrape done", stats());
}
