import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { env } from "./config.js";

mkdirSync(dirname(env.dbPath), { recursive: true });

export const db = new Database(env.dbPath);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");

db.exec(`
CREATE TABLE IF NOT EXISTS cells (
  id             TEXT PRIMARY KEY,
  district       TEXT NOT NULL,
  category       TEXT NOT NULL,
  keyword        TEXT NOT NULL,
  lat            REAL NOT NULL,
  lng            REAL NOT NULL,
  depth          INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'pending',   -- pending | done | capped | failed
  results_count  INTEGER NOT NULL DEFAULT 0,
  attempts       INTEGER NOT NULL DEFAULT 0,
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cells_status ON cells(status);

CREATE TABLE IF NOT EXISTS businesses (
  place_cid        TEXT PRIMARY KEY,
  name             TEXT,
  category_query   TEXT,
  district         TEXT,
  place_url        TEXT,
  address          TEXT,
  lat              REAL,
  lng              REAL,
  phone_raw        TEXT,
  phone_e164       TEXT,
  is_mobile        INTEGER,
  whatsapp_link    TEXT,
  website_url      TEXT,
  website_status   TEXT,          -- ok | none | broken
  website_reason   TEXT,
  instagram_url    TEXT,
  instagram_source TEXT,          -- listing | ddg | bing
  instagram_score  REAL,
  rating           REAL,
  review_count     INTEGER,
  maps_url         TEXT,
  status           TEXT NOT NULL DEFAULT 'discovered', -- discovered | detailed | rejected | target | enriched | failed
  detail_attempts  INTEGER NOT NULL DEFAULT 0,
  enrich_attempts  INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_biz_status ON businesses(status);

CREATE TABLE IF NOT EXISTS website_cache (
  domain         TEXT PRIMARY KEY,
  final_url      TEXT,
  http_status    INTEGER,
  classification TEXT,
  reason         TEXT,
  checked_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS search_cache (
  query_hash  TEXT PRIMARY KEY,
  engine      TEXT,
  html        TEXT,
  fetched_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS suppression (
  value     TEXT PRIMARY KEY,   -- E.164 phone or lowercase instagram handle
  reason    TEXT,
  added_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

export interface CellRow {
  id: string;
  district: string;
  category: string;
  keyword: string;
  lat: number;
  lng: number;
  depth: number;
  status: string;
  results_count: number;
  attempts: number;
}

export interface BusinessRow {
  place_cid: string;
  name: string | null;
  category_query: string | null;
  district: string | null;
  place_url: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  phone_raw: string | null;
  phone_e164: string | null;
  is_mobile: number | null;
  whatsapp_link: string | null;
  website_url: string | null;
  website_status: string | null;
  website_reason: string | null;
  instagram_url: string | null;
  instagram_source: string | null;
  instagram_score: number | null;
  rating: number | null;
  review_count: number | null;
  maps_url: string | null;
  status: string;
  detail_attempts: number;
  enrich_attempts: number;
}

const upsertCellStmt = db.prepare(`
INSERT INTO cells (id, district, category, keyword, lat, lng, depth)
VALUES (@id, @district, @category, @keyword, @lat, @lng, @depth)
ON CONFLICT(id) DO NOTHING
`);

export function upsertCell(c: Omit<CellRow, "status" | "results_count" | "attempts">): void {
  upsertCellStmt.run(c);
}

export function nextPendingCells(limit: number): CellRow[] {
  return db
    .prepare(`SELECT * FROM cells WHERE status = 'pending' AND attempts < 3 ORDER BY depth, rowid LIMIT ?`)
    .all(limit) as CellRow[];
}

export function markCell(id: string, status: string, resultsCount: number): void {
  db.prepare(
    `UPDATE cells SET status = ?, results_count = ?, attempts = attempts + 1, updated_at = datetime('now') WHERE id = ?`,
  ).run(status, resultsCount, id);
}

export function bumpCellAttempt(id: string): void {
  db.prepare(`UPDATE cells SET attempts = attempts + 1, updated_at = datetime('now') WHERE id = ?`).run(id);
}

const insertDiscoveredStmt = db.prepare(`
INSERT INTO businesses (place_cid, name, category_query, district, place_url, lat, lng)
VALUES (@place_cid, @name, @category_query, @district, @place_url, @lat, @lng)
ON CONFLICT(place_cid) DO NOTHING
`);

export function insertDiscovered(b: {
  place_cid: string;
  name: string | null;
  category_query: string;
  district: string;
  place_url: string;
  lat: number | null;
  lng: number | null;
}): boolean {
  return insertDiscoveredStmt.run(b).changes > 0;
}

export function nextBusinesses(status: string, limit: number, attemptField?: "detail_attempts" | "enrich_attempts"): BusinessRow[] {
  const guard = attemptField ? `AND ${attemptField} < 3` : "";
  return db
    .prepare(`SELECT * FROM businesses WHERE status = ? ${guard} ORDER BY rowid LIMIT ?`)
    .all(status, limit) as BusinessRow[];
}

export function updateBusiness(placeCid: string, fields: Partial<BusinessRow>): void {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const set = keys.map((k) => `${k} = @${k}`).join(", ");
  db.prepare(`UPDATE businesses SET ${set}, updated_at = datetime('now') WHERE place_cid = @place_cid`).run({
    ...fields,
    place_cid: placeCid,
  });
}

export function isSuppressed(value: string): boolean {
  return !!db.prepare(`SELECT 1 FROM suppression WHERE value = ?`).get(value.toLowerCase());
}

export function getSearchCache(hash: string): { engine: string; html: string } | undefined {
  return db.prepare(`SELECT engine, html FROM search_cache WHERE query_hash = ?`).get(hash) as
    | { engine: string; html: string }
    | undefined;
}

export function putSearchCache(hash: string, engine: string, html: string): void {
  db.prepare(
    `INSERT INTO search_cache (query_hash, engine, html) VALUES (?, ?, ?) ON CONFLICT(query_hash) DO UPDATE SET engine = excluded.engine, html = excluded.html, fetched_at = datetime('now')`,
  ).run(hash, engine, html);
}

export function getWebsiteCache(domain: string) {
  return db.prepare(`SELECT * FROM website_cache WHERE domain = ?`).get(domain) as
    | { domain: string; final_url: string; http_status: number; classification: string; reason: string }
    | undefined;
}

export function putWebsiteCache(row: {
  domain: string;
  final_url: string | null;
  http_status: number | null;
  classification: string;
  reason: string;
}): void {
  db.prepare(
    `INSERT INTO website_cache (domain, final_url, http_status, classification, reason)
     VALUES (@domain, @final_url, @http_status, @classification, @reason)
     ON CONFLICT(domain) DO UPDATE SET final_url = excluded.final_url, http_status = excluded.http_status,
       classification = excluded.classification, reason = excluded.reason, checked_at = datetime('now')`,
  ).run(row);
}

export function stats(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of db.prepare(`SELECT status, COUNT(*) n FROM businesses GROUP BY status`).all() as {
    status: string;
    n: number;
  }[]) {
    out[`business:${r.status}`] = r.n;
  }
  for (const r of db.prepare(`SELECT status, COUNT(*) n FROM cells GROUP BY status`).all() as {
    status: string;
    n: number;
  }[]) {
    out[`cell:${r.status}`] = r.n;
  }
  return out;
}
