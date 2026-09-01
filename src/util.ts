export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function randomBetween(minSec: number, maxSec: number): number {
  return (minSec + Math.random() * Math.max(0, maxSec - minSec)) * 1000;
}

export async function politeSleep(minSec: number, maxSec: number): Promise<void> {
  await sleep(randomBetween(minSec, maxSec));
}

export function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** Strip diacritics and lowercase. */
export function foldAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function onlyDigits(s: string): string {
  return s.replace(/\D+/g, "");
}

/** Best-effort registrable domain (handles common two-level TLDs like com.br). */
export function registrableDomain(hostname: string): string {
  const host = hostname.replace(/^www\./, "").toLowerCase();
  const parts = host.split(".");
  if (parts.length <= 2) return host;
  const twoLevel = new Set(["com", "net", "org", "gov", "edu", "co"]);
  const last = parts[parts.length - 1]!;
  const penult = parts[parts.length - 2]!;
  if (last === "br" && twoLevel.has(penult)) return parts.slice(-3).join(".");
  return parts.slice(-2).join(".");
}
