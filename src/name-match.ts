import { distance } from "fastest-levenshtein";
import { foldAccents } from "./util.js";

/** Words that carry no identifying signal when matching a business to a profile. */
const STOP_WORDS = new Set([
  "barbearia", "barber", "barbershop", "barbers", "barbeiro",
  "academia", "academy", "gym", "fitness", "crossfit", "studio", "estudio",
  "salao", "salon", "beleza", "cabeleireiro", "cabelereiro", "hair", "nails",
  "tatuagem", "tattoo", "tatuador", "ink", "piercing",
  "ltda", "me", "epp", "eireli", "sa",
  "sao", "paulo", "sp", "brasil", "brazil",
  "oficial", "official", "the", "de", "da", "do", "e",
]);

export function normalizeForMatch(s: string): string {
  return foldAccents(s)
    .replace(/@/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w && !STOP_WORDS.has(w))
    .join(" ")
    .trim();
}

function ratio(a: string, b: string): number {
  if (!a || !b) return 0;
  const d = distance(a, b);
  return 1 - d / Math.max(a.length, b.length);
}

export interface MatchInput {
  businessName: string;
  handle: string;
  profileFullName?: string | null;
  profileBio?: string | null;
  phoneDigits?: string | null;
  addressTokens?: string[];
}

export interface MatchResult {
  score: number;
  accepted: boolean;
  reason: string;
}

/**
 * "Only accept if the Instagram is the same as the customer."
 * Accept when the normalized business name closely matches the handle or the
 * profile's display name, OR the profile clearly references the business's phone
 * or address.
 */
export function scoreInstagramMatch(input: MatchInput): MatchResult {
  const biz = normalizeForMatch(input.businessName);
  const handle = normalizeForMatch(input.handle);
  const fullName = input.profileFullName ? normalizeForMatch(input.profileFullName) : "";

  const nameRatio = Math.max(ratio(biz, handle), ratio(biz, fullName));

  const haystack = foldAccents(`${input.profileBio ?? ""} ${input.profileFullName ?? ""}`);
  const phoneHit =
    !!input.phoneDigits &&
    input.phoneDigits.length >= 8 &&
    haystack.replace(/\D+/g, "").includes(input.phoneDigits.slice(-9));
  const addressHit =
    !!input.addressTokens?.some((t) => t.length >= 5 && haystack.includes(foldAccents(t)));

  // token containment bonus: every business token present in handle/fullname
  const bizTokens = biz.split(" ").filter(Boolean);
  const target = `${handle} ${fullName}`;
  const containment =
    bizTokens.length > 0 && bizTokens.every((t) => target.includes(t)) ? 0.15 : 0;

  const score = Math.min(1, nameRatio + containment + (phoneHit ? 0.3 : 0) + (addressHit ? 0.2 : 0));

  let accepted = false;
  let reason = "no-match";
  if (phoneHit) {
    accepted = true;
    reason = "phone-in-profile";
  } else if (nameRatio + containment >= 0.85) {
    accepted = true;
    reason = "name-match";
  } else if (nameRatio >= 0.7 && addressHit) {
    accepted = true;
    reason = "name+address";
  }

  return { score: Number(score.toFixed(3)), accepted, reason };
}
