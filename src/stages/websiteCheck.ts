import { getWebsiteCache, putWebsiteCache } from "../db.js";
import { registrableDomain } from "../util.js";

export type WebsiteClassification = "ok" | "none" | "broken";

export interface WebsiteResult {
  classification: WebsiteClassification;
  reason: string;
  finalUrl: string | null;
  httpStatus: number | null;
  /** Instagram handle discovered directly from the listing's "website" field. */
  instagramHandle: string | null;
}

const SOCIAL_AS_NO_SITE = /(^|\.)(instagram\.com|instagr\.am|facebook\.com|fb\.com|linktr\.ee|linktree|beacons\.ai|linkbio|bio\.link|linke\.bio)$/i;

const PARKED_FINGERPRINTS = [
  "domain is for sale",
  "this domain is for sale",
  "domínio à venda",
  "buy this domain",
  "the domain has expired",
  "future home of something",
  "sedoparking",
  "bodis.com",
  "hugedomains",
  "godaddy.com/domainsearch",
  "parkingcrew",
  "this website is parked",
  "site não encontrado",
  "página não encontrada",
  "account suspended",
  "default web site page",
  "apache2 debian default page",
  "welcome to nginx",
  "index of /",
];

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function instagramHandleFromUrl(u: URL): string | null {
  if (!/instagram\.com$/i.test(u.hostname.replace(/^www\./, ""))) return null;
  const seg = u.pathname.split("/").filter(Boolean)[0];
  if (!seg) return null;
  if (["p", "reel", "reels", "explore", "stories", "tags", "accounts"].includes(seg.toLowerCase())) return null;
  return seg.toLowerCase();
}

export async function classifyWebsite(rawUrl: string | null | undefined): Promise<WebsiteResult> {
  if (!rawUrl || !rawUrl.trim()) {
    return { classification: "none", reason: "no-website-listed", finalUrl: null, httpStatus: null, instagramHandle: null };
  }

  let url: URL;
  try {
    url = new URL(rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`);
  } catch {
    return { classification: "broken", reason: "unparseable-url", finalUrl: rawUrl, httpStatus: null, instagramHandle: null };
  }

  const host = url.hostname.replace(/^www\./, "");
  if (SOCIAL_AS_NO_SITE.test(host)) {
    return {
      classification: "none",
      reason: `social-only:${host}`,
      finalUrl: url.toString(),
      httpStatus: null,
      instagramHandle: instagramHandleFromUrl(url),
    };
  }

  const domain = registrableDomain(url.hostname);
  const cached = getWebsiteCache(domain);
  if (cached) {
    return {
      classification: cached.classification as WebsiteClassification,
      reason: `${cached.reason} (cached)`,
      finalUrl: cached.final_url,
      httpStatus: cached.http_status,
      instagramHandle: null,
    };
  }

  const result = await probe(url);
  putWebsiteCache({
    domain,
    final_url: result.finalUrl,
    http_status: result.httpStatus,
    classification: result.classification,
    reason: result.reason,
  });
  return result;
}

async function probe(url: URL): Promise<WebsiteResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": UA, accept: "text/html,*/*", "accept-language": "pt-BR,pt;q=0.9" },
    });

    const finalUrl = res.url || url.toString();
    if (res.status >= 400) {
      return { classification: "broken", reason: `http-${res.status}`, finalUrl, httpStatus: res.status, instagramHandle: null };
    }

    // Redirected off to an unrelated social / marketplace host?
    try {
      const finalHost = new URL(finalUrl).hostname.replace(/^www\./, "");
      if (SOCIAL_AS_NO_SITE.test(finalHost)) {
        return {
          classification: "none",
          reason: `redirects-to-social:${finalHost}`,
          finalUrl,
          httpStatus: res.status,
          instagramHandle: instagramHandleFromUrl(new URL(finalUrl)),
        };
      }
    } catch {
      /* ignore */
    }

    const body = (await res.text()).slice(0, 200_000);
    const lower = body.toLowerCase();

    if (body.replace(/\s+/g, "").length < 500) {
      return { classification: "broken", reason: "thin-body", finalUrl, httpStatus: res.status, instagramHandle: null };
    }
    const fp = PARKED_FINGERPRINTS.find((f) => lower.includes(f));
    if (fp) {
      return { classification: "broken", reason: `parked:${fp}`, finalUrl, httpStatus: res.status, instagramHandle: null };
    }

    return { classification: "ok", reason: "reachable", finalUrl, httpStatus: res.status, instagramHandle: null };
  } catch (err) {
    const msg = (err as Error).name === "AbortError" ? "timeout" : (err as Error).message || "network-error";
    return { classification: "broken", reason: `unreachable:${msg}`.slice(0, 120), finalUrl: null, httpStatus: null, instagramHandle: null };
  } finally {
    clearTimeout(timer);
  }
}
