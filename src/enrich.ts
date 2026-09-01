import pLimit from "p-limit";
import { area, env } from "./config.js";
import { isSuppressed, nextBusinesses, updateBusiness, stats, type BusinessRow } from "./db.js";
import { classifyWebsite } from "./stages/websiteCheck.js";
import { findInstagram } from "./stages/instagram.js";
import { toWhatsapp } from "./stages/whatsapp.js";
import { log } from "./logger.js";

/** Stage 1: classify the website of every `detailed` business. */
async function filterPhase(limit: number): Promise<void> {
  const lim = pLimit(env.enrichConcurrency);
  let processed = 0;

  while (processed < limit) {
    const batch = nextBusinesses("detailed", Math.min(100, limit - processed));
    if (!batch.length) break;

    await Promise.all(
      batch.map((biz) =>
        lim(async () => {
          const wc = await classifyWebsite(biz.website_url);
          const isTarget = wc.classification === "none" || wc.classification === "broken";
          updateBusiness(biz.place_cid, {
            website_status: wc.classification,
            website_reason: wc.reason,
            // stash a handle found directly on the listing for the enrich phase
            instagram_url: wc.instagramHandle ? `https://www.instagram.com/${wc.instagramHandle}/` : null,
            instagram_source: wc.instagramHandle ? "listing" : null,
            instagram_score: wc.instagramHandle ? 1 : null,
            status: isTarget ? "target" : "rejected",
          });
        }),
      ),
    );
    processed += batch.length;
    log.info("filter progress", { processed });
  }
  log.info("filter phase complete", { processed });
}

/** Stage 2: for every `target`, resolve WhatsApp + a verified Instagram. */
async function enrichPhase(limit: number): Promise<void> {
  const lim = pLimit(env.enrichConcurrency);
  let processed = 0;

  while (processed < limit) {
    const batch = nextBusinesses("target", Math.min(50, limit - processed), "enrich_attempts");
    if (!batch.length) break;

    await Promise.all(batch.map((biz) => lim(() => enrichOne(biz))));
    processed += batch.length;
    log.info("enrich progress", { processed });
  }
  log.info("enrich phase complete", { processed });
}

async function enrichOne(biz: BusinessRow): Promise<void> {
  try {
    const wa = toWhatsapp(biz.phone_raw);
    if (wa.e164 && isSuppressed(wa.e164)) {
      updateBusiness(biz.place_cid, { status: "rejected", website_reason: "suppressed-phone" });
      return;
    }

    const knownHandle =
      biz.instagram_source === "listing" && biz.instagram_url
        ? biz.instagram_url.split("/").filter(Boolean).pop() ?? null
        : null;

    let igUrl = biz.instagram_url;
    let igSource = biz.instagram_source;
    let igScore = biz.instagram_score;

    if (biz.name) {
      const match = await findInstagram({
        name: biz.name,
        city: area.city,
        phoneE164: wa.e164,
        address: biz.address,
        knownHandle,
      });
      if (match && !isSuppressed(match.handle)) {
        igUrl = match.url;
        igSource = match.source;
        igScore = match.score;
      } else if (!knownHandle) {
        igUrl = null;
        igSource = null;
        igScore = null;
      }
    }

    updateBusiness(biz.place_cid, {
      phone_e164: wa.e164,
      is_mobile: wa.isMobile === null ? null : wa.isMobile ? 1 : 0,
      whatsapp_link: wa.link,
      instagram_url: igUrl,
      instagram_source: igSource,
      instagram_score: igScore,
      status: "enriched",
      enrich_attempts: biz.enrich_attempts + 1,
    });
    log.info("enriched", { cid: biz.place_cid, name: biz.name, ig: igUrl ?? "-", wa: wa.e164 ?? "-" });
  } catch (err) {
    const attempts = biz.enrich_attempts + 1;
    updateBusiness(biz.place_cid, {
      status: attempts >= 3 ? "enriched" : "target",
      enrich_attempts: attempts,
    });
    log.warn("enrich failed", { cid: biz.place_cid, attempts, err: (err as Error).message });
  }
}

export async function enrich(opts: { limit?: number } = {}): Promise<void> {
  const limit = opts.limit ?? Number.MAX_SAFE_INTEGER;
  await filterPhase(limit);
  await enrichPhase(limit);
  log.info("enrich done", stats());
}
