# lp-crm-scraper

Lead scraper for **São Paulo** small businesses. It walks Google Maps over a
tiled grid, keeps only businesses that have **no website or a broken one**, and
enriches each with a **WhatsApp link** and a **Instagram profile that is verified
to actually belong to that business**. Output is a local CSV another app consumes.

```
name, instagram_url, whatsapp_number, whatsapp_link, website_status, category, address, maps_url
```

## Categories

`barbershop` · `gym` · `salon` · `tattoo` — configured in
[config/categories.json](config/categories.json) as pt-BR search keywords.

## How it works

```
seed     config/districts.json + categories  ->  cells table (grid of map searches)
scrape   Playwright drives Google Maps:
           SEARCH  each cell -> scroll feed -> discovered businesses
           DETAIL  each place -> name / phone / website / address
enrich   (no browser)
           FILTER  classify website ok | none | broken  -> keep none + broken
           ENRICH  WhatsApp (wa.me) + Instagram (listing link, else DuckDuckGo/Bing + verify)
export   businesses -> output/leads-sao-paulo.csv   (atomic write)
```

State lives in a single SQLite file (`data/leads.sqlite`). Every stage is
**resumable** — stop and re-run any command and it continues where it left off.

## Setup

```bash
npm install            # also runs: playwright install chromium
cp .env.example .env    # optional — defaults are fine
```

## Usage

```bash
# 1. Scrape a couple of central districts first to validate selectors
npm run scrape -- --districts pinheiros,consolacao --limit-cells 20

# 2. Full central slice
npm run scrape -- --districts pinheiros,consolacao,itaim-bibi,vila-mariana,republica

# 3. Enrich (website classification + WhatsApp + Instagram)
npm run enrich

# 4. Export the CSV
npm run export

# progress at any time
npm run stats
```

Useful flags: `--seed-only`, `--skip-detail`, `--limit-details <n>` on `scrape`;
`--limit <n>` on `enrich`; `--include-pending`, `--with-instagram-only` on `export`.

### Scaling to the whole city

`config/districts.json` currently holds a central validation slice. To cover the
full municipality, add districts (or one city-wide bbox) and, ideally, a
`config/sao-paulo.geojson` boundary so out-of-city grid cells are skipped. Expect
a multi-day crawl and plan for a proxy (`PROXY_URL` in `.env`) if Google starts
serving CAPTCHAs.

## Instagram verification

A candidate profile is attached **only** when it is the same as the customer:

- the normalized business name closely matches the handle or the profile's
  display name, **or**
- the profile bio/name contains the business's phone or a distinctive address
  token.

Otherwise `instagram_url` is left blank — no guesses.

## Tests

```bash
npm test              # pure-function unit tests
SMOKE=1 npm test      # + live Google Maps selector canary (browser + network)
npm run typecheck
```

## Legal / compliance

- Scraping Google Maps and search engines is against their Terms of Service.
  Selectors break when Google changes its markup — the smoke test is the canary.
- This targets **business** contact data, but under the **LGPD** a sole trader's
  phone/Instagram can still be personal data. Establish a legitimate-interest
  basis, honor opt-outs (the `suppression` table — add an E.164 number or an
  Instagram handle to exclude it everywhere), and do not use this for automated
  bulk messaging.
- Use responsibly and at your own risk.
