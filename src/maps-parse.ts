import { onlyDigits } from "./util.js";

/**
 * Extract a stable place identifier from a Google Maps place URL / card href.
 * The `!1s0x...:0x...` token (a.k.a. the place's feature id / CID hex pair) is
 * the most stable key Maps exposes in the URL.
 */
export function extractPlaceCid(href: string | null | undefined): string | null {
  if (!href) return null;
  const feature = href.match(/!1s(0x[0-9a-fA-F]+:0x[0-9a-fA-F]+)/);
  if (feature) return feature[1]!.toLowerCase();

  const ludocid = href.match(/[?&]ludocid=(\d+)/);
  if (ludocid) return `ludocid:${ludocid[1]}`;

  const cid = href.match(/[?&]cid=(\d+)/);
  if (cid) return `cid:${cid[1]}`;

  // Fallback: the place slug in /maps/place/<slug>/
  const slug = href.match(/\/maps\/place\/([^/]+)/);
  if (slug) return `slug:${decodeURIComponent(slug[1]!).toLowerCase()}`;

  return null;
}

/** `phone:tel:+55 11 91234-5678` -> `+55 11 91234-5678` */
export function phoneFromDataItemId(dataItemId: string | null | undefined): string | null {
  if (!dataItemId) return null;
  const m = dataItemId.match(/^phone:tel:(.+)$/);
  return m ? m[1]!.trim() : null;
}

/** "4,8" or "4.8" -> 4.8 */
export function parseRating(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = text.replace(",", ".").match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

/** "(1.234)" / "1.234 avaliações" -> 1234 */
export function parseReviewCount(text: string | null | undefined): number | null {
  if (!text) return null;
  const digits = onlyDigits(text);
  return digits ? Number(digits) : null;
}

const MAPS_ORIGIN = "https://www.google.com";

export function absoluteMapsUrl(href: string): string {
  try {
    return new URL(href, MAPS_ORIGIN).toString();
  } catch {
    return href;
  }
}
