#!/usr/bin/env bash
# Drain the detail backlog in batches, re-running enrich + export after each
# batch so output/leads-sao-paulo.csv grows as it goes.
#
#   scripts/pipeline.sh [BATCH_SIZE]
#
set -euo pipefail
cd "$(dirname "$0")/.."

BATCH="${1:-150}"

while true; do
  REMAINING=$(node -e "const db=require('better-sqlite3')('data/leads.sqlite');const r=db.prepare(\"SELECT count(*) n FROM businesses WHERE status='discovered' AND detail_attempts<3\").get();console.log(r.n)")
  echo ">>> discovered remaining: $REMAINING"
  [ "$REMAINING" -eq 0 ] && break

  npm run detail -- --limit "$BATCH"
  npm run enrich
  npm run export
  echo ">>> $(date -Is) batch done"
done

npm run enrich
npm run export
echo ">>> PIPELINE_DONE"
npm run stats
