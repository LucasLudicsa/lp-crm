import type { Page } from "playwright";
import { SEL } from "../selectors.js";
import { dismissConsent } from "../browser/context.js";
import { parseRating, parseReviewCount, phoneFromDataItemId } from "../maps-parse.js";
import { log } from "../logger.js";
import { updateBusiness, type BusinessRow } from "../db.js";

async function textOf(page: Page, selector: string): Promise<string | null> {
  const loc = page.locator(selector).first();
  if (!(await loc.count().catch(() => 0))) return null;
  return (await loc.textContent().catch(() => null))?.trim() || null;
}

export interface PlaceDetail {
  name: string | null;
  category: string | null;
  address: string | null;
  phoneRaw: string | null;
  websiteUrl: string | null;
  rating: number | null;
  reviewCount: number | null;
  mapsUrl: string;
}

export async function scrapeDetail(page: Page, placeUrl: string): Promise<PlaceDetail> {
  await page.goto(placeUrl, { waitUntil: "domcontentloaded" });
  await dismissConsent(page);
  await page.waitForSelector(SEL.detailName, { timeout: 20_000 });

  const phoneBtn = page.locator(SEL.phoneButton).first();
  const phoneRaw = (await phoneBtn.count().catch(() => 0))
    ? phoneFromDataItemId(await phoneBtn.getAttribute("data-item-id")) ??
      (await textOf(page, `${SEL.phoneButton} .Io6YTe`))
    : null;

  const websiteLink = page.locator(SEL.websiteLink).first();
  const websiteUrl = (await websiteLink.count().catch(() => 0))
    ? await websiteLink.getAttribute("href")
    : null;

  return {
    name: await textOf(page, SEL.detailName),
    category: await textOf(page, SEL.detailCategory),
    address: (await textOf(page, SEL.addressText)) ?? (await textOf(page, SEL.address)),
    phoneRaw,
    websiteUrl,
    rating: parseRating(await textOf(page, SEL.ratingText)),
    reviewCount: parseReviewCount(await textOf(page, SEL.reviewCountText)),
    mapsUrl: page.url(),
  };
}

export async function runDetail(page: Page, biz: BusinessRow): Promise<void> {
  if (!biz.place_url) {
    updateBusiness(biz.place_cid, { status: "failed", website_reason: "no-place-url" });
    return;
  }
  try {
    const d = await scrapeDetail(page, biz.place_url);
    updateBusiness(biz.place_cid, {
      name: d.name ?? biz.name,
      category_query: biz.category_query,
      address: d.address,
      phone_raw: d.phoneRaw,
      website_url: d.websiteUrl,
      rating: d.rating,
      review_count: d.reviewCount,
      maps_url: d.mapsUrl,
      status: "detailed",
      detail_attempts: biz.detail_attempts + 1,
    });
    log.info("detailed", { cid: biz.place_cid, name: d.name, website: d.websiteUrl ?? "-" });
  } catch (err) {
    const attempts = biz.detail_attempts + 1;
    updateBusiness(biz.place_cid, {
      status: attempts >= 3 ? "failed" : "discovered",
      detail_attempts: attempts,
      website_reason: `detail-error:${(err as Error).message}`.slice(0, 120),
    });
    log.warn("detail failed", { cid: biz.place_cid, attempts, err: (err as Error).message });
  }
}
