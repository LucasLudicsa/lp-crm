/**
 * Canary test: runs a single real Google Maps search and asserts that our
 * selectors still return the fields we depend on. It hits the network and
 * launches a browser, so it is OFF by default. Enable with:
 *
 *   SMOKE=1 npm test
 *
 * If this fails after a Google redesign, fix src/selectors.ts.
 */
import { describe, expect, it } from "vitest";

const RUN = process.env.SMOKE === "1";

describe.skipIf(!RUN)("google maps selectors (live)", () => {
  it("returns cards for a central São Paulo search and details for the first", async () => {
    const { openSession } = await import("../src/browser/context.js");
    const { scrapeDetail } = await import("../src/stages/detail.js");
    const { SEL } = await import("../src/selectors.js");
    const { extractPlaceCid } = await import("../src/maps-parse.js");

    const session = await openSession();
    const page = await session.newPage();
    try {
      await page.goto(
        "https://www.google.com/maps/search/barbearia/@-23.561,-46.692,15z?hl=pt-BR&gl=br",
        { waitUntil: "domcontentloaded" },
      );
      const { dismissConsent } = await import("../src/browser/context.js");
      await dismissConsent(page);
      await page.waitForSelector(SEL.resultLink, { timeout: 30_000 });

      const hrefs = await page.$$eval(SEL.resultLink, (els) =>
        els.map((e) => (e as HTMLAnchorElement).href),
      );
      expect(hrefs.length).toBeGreaterThan(0);
      expect(extractPlaceCid(hrefs[0]!)).toBeTruthy();

      const detail = await scrapeDetail(page, hrefs[0]!);
      expect(detail.name, "place name").toBeTruthy();
      expect(detail.mapsUrl).toContain("google.com/maps");
    } finally {
      await session.close();
    }
  }, 120_000);
});
