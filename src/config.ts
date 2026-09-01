import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { z } from "zod";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const p = (rel: string) => resolve(root, rel);

function loadJson(rel: string): unknown {
  return JSON.parse(readFileSync(p(rel), "utf8"));
}

const areaSchema = z.object({
  city: z.string(),
  searchZoom: z.number(),
  cellKm: z.number().positive(),
  maxResultsPerCell: z.number().int().positive(),
  maxSubdivideDepth: z.number().int().min(0),
  hl: z.string(),
  gl: z.string(),
  geolocation: z.object({ latitude: z.number(), longitude: z.number() }),
});

const categoriesSchema = z.array(
  z.object({ id: z.string(), keywords: z.array(z.string()).min(1) }),
);

const districtsSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    // [minLat, minLng, maxLat, maxLng]
    bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  }),
);

export const area = areaSchema.parse(loadJson("config/area.json"));
export const categories = categoriesSchema.parse(loadJson("config/categories.json"));
export const districts = districtsSchema.parse(loadJson("config/districts.json"));

export type Category = (typeof categories)[number];
export type District = (typeof districts)[number];

export const env = {
  dbPath: process.env.DB_PATH ?? p("data/leads.sqlite"),
  outputCsv: process.env.OUTPUT_CSV ?? p("output/leads-sao-paulo.csv"),
  headful: process.env.HEADFUL === "1",
  proxyUrl: process.env.PROXY_URL || undefined,
  searchMinDelay: Number(process.env.SEARCH_MIN_DELAY ?? 8),
  searchMaxDelay: Number(process.env.SEARCH_MAX_DELAY ?? 20),
  detailMinDelay: Number(process.env.DETAIL_MIN_DELAY ?? 3),
  detailMaxDelay: Number(process.env.DETAIL_MAX_DELAY ?? 8),
  enrichConcurrency: Number(process.env.ENRICH_CONCURRENCY ?? 4),
};

export function keywordsForCategories(ids: string[] | undefined): { category: string; keyword: string }[] {
  const selected = ids && ids.length ? categories.filter((c) => ids.includes(c.id)) : categories;
  return selected.flatMap((c) => c.keywords.map((keyword) => ({ category: c.id, keyword })));
}

export function selectDistricts(ids: string[] | undefined): District[] {
  if (!ids || !ids.length) return districts;
  return districts.filter((d) => ids.includes(d.id));
}
