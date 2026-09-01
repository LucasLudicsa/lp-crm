import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import { getSearchCache, putSearchCache } from "../db.js";
import { scoreInstagramMatch } from "../name-match.js";
import { foldAccents, onlyDigits, sleep } from "../util.js";
import { log } from "../logger.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const RESERVED = new Set([
  "p", "reel", "reels", "explore", "stories", "tags", "accounts", "about",
  "developer", "legal", "directory", "web", "help", "press", "api",
]);

export interface InstagramMatch {
  url: string;
  handle: string;
  source: "listing" | "ddg" | "bing";
  score: number;
  reason: string;
}

export interface EnrichInput {
  name: string;
  city?: string;
  phoneE164?: string | null;
  address?: string | null;
  /** handle already known from the Maps listing "website" field */
  knownHandle?: string | null;
}

function hash(s: string): string {
  return createHash("sha1").update(s).digest("hex");
}

async function fetchText(url: string, cacheKey?: string, engine?: string): Promise<string | null> {
  if (cacheKey) {
    const hit = getSearchCache(hash(cacheKey));
    if (hit) return hit.html;
  }
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent": UA,
        "accept-language": "pt-BR,pt;q=0.9,en;q=0.8",
        accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    if (cacheKey && engine) putSearchCache(hash(cacheKey), engine, html);
    return html;
  } catch (err) {
    log.debug("fetchText failed", { url, err: (err as Error).message });
    return null;
  }
}

function decodeDdgHref(href: string): string {
  // DDG html wraps external links: //duckduckgo.com/l/?uddg=<encoded>&...
  const m = href.match(/[?&]uddg=([^&]+)/);
  if (m) {
    try {
      return decodeURIComponent(m[1]!);
    } catch {
      return href;
    }
  }
  return href.startsWith("//") ? `https:${href}` : href;
}

function extractInstagramHandles(html: string): string[] {
  const $ = cheerio.load(html);
  const handles: string[] = [];
  $("a[href]").each((_, el) => {
    const raw = $(el).attr("href")!;
    const href = decodeDdgHref(raw);
    const m = href.match(/https?:\/\/(?:www\.)?instagram\.com\/([^/?#]+)/i);
    if (!m) return;
    const handle = m[1]!.toLowerCase().replace(/\/$/, "");
    if (RESERVED.has(handle) || handle.includes("=") || handle.length < 2) return;
    if (!handles.includes(handle)) handles.push(handle);
  });
  return handles;
}

async function searchHandles(query: string): Promise<{ handle: string; source: "ddg" | "bing" }[]> {
  const out: { handle: string; source: "ddg" | "bing" }[] = [];

  const ddg = await fetchText(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=br-pt`,
    `ddg::${query}`,
    "ddg",
  );
  if (ddg) for (const h of extractInstagramHandles(ddg)) out.push({ handle: h, source: "ddg" });

  if (out.length === 0) {
    await sleep(1500);
    const bing = await fetchText(
      `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=pt-BR&cc=br`,
      `bing::${query}`,
      "bing",
    );
    if (bing) for (const h of extractInstagramHandles(bing)) out.push({ handle: h, source: "bing" });
  }

  // de-dupe preserving order
  const seen = new Set<string>();
  return out.filter((x) => (seen.has(x.handle) ? false : seen.add(x.handle)));
}

export interface ProfileMeta {
  fullName: string | null;
  bio: string | null;
  exists: boolean;
}

export async function fetchProfileMeta(handle: string): Promise<ProfileMeta> {
  const html = await fetchText(`https://www.instagram.com/${handle}/`, `ig-profile::${handle}`, "instagram");
  if (!html) return { fullName: null, bio: null, exists: false };
  const $ = cheerio.load(html);
  const ogTitle = $('meta[property="og:title"]').attr("content") ?? null;
  const ogDesc = $('meta[property="og:description"]').attr("content") ?? null;
  const description = $('meta[name="description"]').attr("content") ?? null;

  // og:title -> "Full Name (@handle) • Instagram photos and videos"
  let fullName: string | null = null;
  if (ogTitle) {
    const m = ogTitle.match(/^(.*?)\s*\(@/);
    fullName = (m?.[1] ?? ogTitle).trim() || null;
  }
  const exists = !!ogTitle || !!ogDesc;
  return { fullName, bio: [ogDesc, description].filter(Boolean).join(" ") || null, exists };
}

export async function findInstagram(input: EnrichInput): Promise<InstagramMatch | null> {
  const addressTokens = (input.address ?? "")
    .split(/[,\-–]/)
    .map((s) => foldAccents(s.trim()))
    .filter((s) => s.length >= 5);
  const phoneDigits = input.phoneE164 ? onlyDigits(input.phoneE164) : null;

  // 1. Handle taken straight from the Maps listing — trust it.
  if (input.knownHandle) {
    return {
      url: `https://www.instagram.com/${input.knownHandle}/`,
      handle: input.knownHandle,
      source: "listing",
      score: 1,
      reason: "from-listing",
    };
  }

  // 2. Search engines
  const query = `"${input.name}" ${input.city ?? "São Paulo"} instagram`;
  const candidates = await searchHandles(query);
  if (!candidates.length) return null;

  let best: InstagramMatch | null = null;
  for (const cand of candidates.slice(0, 5)) {
    const meta = await fetchProfileMeta(cand.handle);
    await sleep(1200);
    if (!meta.exists) continue;

    const m = scoreInstagramMatch({
      businessName: input.name,
      handle: cand.handle,
      profileFullName: meta.fullName,
      profileBio: meta.bio,
      phoneDigits,
      addressTokens,
    });

    if (!best || m.score > best.score) {
      best = {
        url: `https://www.instagram.com/${cand.handle}/`,
        handle: cand.handle,
        source: cand.source,
        score: m.score,
        reason: m.reason,
      };
    }
    if (m.accepted) {
      return {
        url: `https://www.instagram.com/${cand.handle}/`,
        handle: cand.handle,
        source: cand.source,
        score: m.score,
        reason: m.reason,
      };
    }
  }

  // Nothing met the "same as the customer" bar — return null so the CSV
  // column stays blank rather than carrying a guess.
  log.debug("no accepted instagram match", { name: input.name, best });
  return null;
}
