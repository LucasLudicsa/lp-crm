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
  /** search N cells, then detail everything discovered, then repeat (default 8) */
  chunk?: number;
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

/** Scrape up to `limit` pending search cells. Returns how many were processed. */
export async function searchPhase(limit = Number.MAX_SAFE_INTEGER): Promise<number> {
  const session = await openSession();
  const page = await session.newPage();
  let processed = 0;
  try {
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
  } finally {
    await session.close();
  }
  log.info("search phase complete", { processed });
  return processed;
}

/** Fetch place details for up to `limit` discovered businesses. Returns how many. */
export async function detailPhase(limit = Number.MAX_SAFE_INTEGER): Promise<number> {
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
  } finally {
    await session.close();
  }
  log.info("detail phase complete", { processed, workers });
  return processed;
}

/**
 * Seed, then interleave search and detail in chunks so an interrupted run still
 * leaves fully-processed rows behind. Everything is resumable — just run again.
 */
export async function scrape(opts: ScrapeOptions): Promise<void> {
  seedCells(opts);
  if (opts.seedOnly) return;

  const chunk = opts.chunk ?? 8;
  let cellsLeft = opts.limitCells ?? Number.MAX_SAFE_INTEGER;
  let detailsLeft = opts.limitDetails ?? Number.MAX_SAFE_INTEGER;

  for (;;) {
    const searched = await searchPhase(Math.min(chunk, cellsLeft));
    cellsLeft -= searched;

    let detailed = 0;
    if (!opts.skipDetail && detailsLeft > 0) {
      detailed = await detailPhase(detailsLeft);
      detailsLeft -= detailed;
    }

    log.info("chunk complete", { ...stats() });
    if (searched === 0 && detailed === 0) break;
    if (cellsLeft <= 0 && (opts.skipDetail || detailsLeft <= 0)) break;
  }
  log.info("scrape done", stats());
}
