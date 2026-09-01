import { parsePhoneNumberFromString, type NumberType } from "libphonenumber-js";

export interface WhatsappResult {
  e164: string | null;
  isMobile: boolean | null;
  link: string | null;
}

/**
 * Normalize a Brazilian phone string from a Maps listing.
 * We do NOT check whether the number is actually registered on WhatsApp —
 * unofficial checks get numbers banned. We emit a wa.me link for any valid
 * number and flag whether it's a mobile line.
 */
export function toWhatsapp(raw: string | null | undefined): WhatsappResult {
  if (!raw) return { e164: null, isMobile: null, link: null };
  const parsed = parsePhoneNumberFromString(raw, "BR");
  if (!parsed || !parsed.isValid()) return { e164: null, isMobile: null, link: null };

  return {
    e164: parsed.number,
    isMobile: detectMobile(parsed.countryCallingCode, parsed.nationalNumber, parsed.getType()),
    link: `https://wa.me/${parsed.number.replace("+", "")}`,
  };
}

function detectMobile(cc: string, national: string, type: NumberType | undefined): boolean | null {
  if (type === "MOBILE" || type === "FIXED_LINE_OR_MOBILE") return true;
  if (type === "FIXED_LINE") return false;

  // BR heuristic: 2-digit area code + 9-digit subscriber starting with 9 = mobile;
  // + 8-digit subscriber = landline.
  if (cc === "55") {
    if (national.length === 11 && national[2] === "9") return true;
    if (national.length === 10) return false;
  }
  return null;
}
