/**
 * Every Google Maps DOM selector lives here. When Google ships a redesign this
 * is the only file that should need touching — the smoke test in
 * tests/selectors.smoke.test.ts is the canary that tells you when.
 *
 * Last verified: 2025 layout.
 */
export const SEL = {
  // Cookie / consent interstitial (consent.google.com)
  consentButtons: [
    'button[aria-label="Aceitar tudo"]',
    'button[aria-label="Accept all"]',
    'form[action*="consent"] button',
    'button:has-text("Aceitar tudo")',
    'button:has-text("Accept all")',
  ],

  // --- Search results feed ---
  feed: 'div[role="feed"]',
  resultLink: 'a.hfpxzc', // each result card is an <a> whose href points at the place
  feedEndSentinel: ".HlvSq", // "You've reached the end of the list."

  // --- Place detail panel ---
  detailName: "h1.DUwDvf",
  detailCategory: 'button[jsaction*="category"]',
  address: 'button[data-item-id="address"]',
  addressText: 'button[data-item-id="address"] .Io6YTe',
  phoneButton: 'button[data-item-id^="phone:tel:"]',
  websiteLink: 'a[data-item-id="authority"]',
  ratingText: ".F7nice span[aria-hidden='true']",
  reviewCountText: '.F7nice span[aria-label*="avalia"], .F7nice span[aria-label*="review"]',
} as const;
