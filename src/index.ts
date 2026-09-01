import { Command } from "commander";
import { detailPhase, scrape, searchPhase, seedCells } from "./pipeline.js";
import { enrich } from "./enrich.js";
import { exportCsv } from "./export.js";
import { stats } from "./db.js";
import { log } from "./logger.js";

const list = (v: string) => v.split(",").map((s) => s.trim()).filter(Boolean);
const int = (v: string) => Number.parseInt(v, 10);

const program = new Command();
program.name("lp-crm-scraper").description("São Paulo lead scraper → CSV");

program
  .command("scrape")
  .description("Seed grid cells, scrape Google Maps search + place details")
  .option("--districts <ids>", "comma-separated district ids (default: all in config)", list)
  .option("--categories <ids>", "comma-separated category ids (default: all in config)", list)
  .option("--limit-cells <n>", "max search cells this run", int)
  .option("--limit-details <n>", "max place-detail pages this run", int)
  .option("--chunk <n>", "search N cells, then detail all discovered, then repeat (default 8)", int)
  .option("--seed-only", "only populate the cells table, then exit")
  .option("--skip-detail", "run search phase only")
  .action(async (o) => {
    await scrape({
      districts: o.districts,
      categories: o.categories,
      limitCells: o.limitCells,
      limitDetails: o.limitDetails,
      chunk: o.chunk,
      seedOnly: o.seedOnly,
      skipDetail: o.skipDetail,
    });
  });

program
  .command("seed")
  .description("Populate the cells table only")
  .option("--districts <ids>", "", list)
  .option("--categories <ids>", "", list)
  .action((o) => {
    seedCells({ districts: o.districts, categories: o.categories });
  });

program
  .command("search")
  .description("Run only the Google Maps search phase over pending cells")
  .option("--districts <ids>", "", list)
  .option("--categories <ids>", "", list)
  .option("--limit <n>", "max search cells this run", int)
  .action(async (o) => {
    seedCells({ districts: o.districts, categories: o.categories });
    await searchPhase(o.limit);
  });

program
  .command("detail")
  .description("Run only the place-detail phase over discovered businesses")
  .option("--limit <n>", "max place-detail pages this run", int)
  .action(async (o) => {
    await detailPhase(o.limit);
  });

program
  .command("enrich")
  .description("Classify websites, then resolve WhatsApp + verified Instagram for targets")
  .option("--limit <n>", "max businesses per phase this run", int)
  .action(async (o) => {
    await enrich({ limit: o.limit });
  });

program
  .command("export")
  .description("Write the CSV deliverable")
  .option("--out <path>", "output path (default: config / .env)")
  .option("--include-pending", "also include target rows not yet enriched")
  .option("--with-instagram-only", "only rows that have a verified Instagram")
  .option("--include-unreachable", "keep rows with no WhatsApp and no Instagram")
  .action((o) => {
    exportCsv({
      outPath: o.out,
      includePending: o.includePending,
      withInstagramOnly: o.withInstagramOnly,
      includeUnreachable: o.includeUnreachable,
    });
  });

program
  .command("stats")
  .description("Print pipeline counts")
  .action(() => {
    log.info("pipeline stats", stats());
  });

program.parseAsync().catch((err) => {
  log.error("fatal", { err: (err as Error).stack ?? String(err) });
  process.exitCode = 1;
});
