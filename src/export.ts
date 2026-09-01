import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { stringify } from "csv-stringify/sync";
import { db } from "./db.js";
import { env } from "./config.js";
import { log } from "./logger.js";

export interface ExportOptions {
  outPath?: string;
  /** also include `target` rows that were not fully enriched yet */
  includePending?: boolean;
  /** only rows with a verified Instagram */
  withInstagramOnly?: boolean;
}

const COLUMNS = [
  "name",
  "instagram_url",
  "whatsapp_number",
  "whatsapp_link",
  "website_status",
  "category",
  "address",
  "maps_url",
] as const;

export function exportCsv(opts: ExportOptions = {}): { path: string; rows: number } {
  const outPath = opts.outPath ?? env.outputCsv;
  const statuses = opts.includePending ? ["enriched", "target"] : ["enriched"];
  const placeholders = statuses.map(() => "?").join(",");

  const rows = db
    .prepare(
      `SELECT name, instagram_url, phone_e164, whatsapp_link, website_status,
              category_query AS category, address, maps_url
       FROM businesses
       WHERE status IN (${placeholders})
         AND website_status IN ('none','broken')
       ORDER BY district, category_query, name`,
    )
    .all(...statuses) as Record<string, string | null>[];

  const filtered = opts.withInstagramOnly ? rows.filter((r) => r.instagram_url) : rows;

  const records = filtered.map((r) => ({
    name: r.name ?? "",
    instagram_url: r.instagram_url ?? "",
    whatsapp_number: r.phone_e164 ?? "",
    whatsapp_link: r.whatsapp_link ?? "",
    website_status: r.website_status ?? "",
    category: r.category ?? "",
    address: r.address ?? "",
    maps_url: r.maps_url ?? "",
  }));

  const csv = stringify(records, { header: true, columns: COLUMNS as unknown as string[] });

  mkdirSync(dirname(outPath), { recursive: true });
  const tmp = `${outPath}.tmp`;
  writeFileSync(tmp, csv, "utf8");
  renameSync(tmp, outPath); // atomic — the consuming app never sees a partial file

  log.info("exported CSV", { path: outPath, rows: records.length });
  return { path: outPath, rows: records.length };
}
