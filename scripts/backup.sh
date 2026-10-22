#!/usr/bin/env bash
# Full backup of the production Supabase project: schema, data (public, auth,
# storage metadata) and every Storage object (PDFs, thumbnails). Read-only
# against production; writes to ~/backups/read-later/<UTC timestamp>/ —
# outside the repo, because the deploy rsyncs the working tree to the server
# and a dump holds auth.users password hashes.
#
#   bash scripts/backup.sh            # → ~/backups/read-later/20261012T120000Z/
#   BACKUP_DIR=/path bash scripts/backup.sh
#
# Needs the `sb` wrapper (per-project Supabase CLI profile, see
# ~/.agents/SETUP.md) logged in for this project. Restore: see
# docs/architecture.md §8 "Backup and restore".
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
out="${BACKUP_DIR:-$HOME/backups/read-later/$stamp}"
mkdir -p "$out/storage"

echo "▸ schema → $out/schema.sql"
sb db dump --linked -f "$out/schema.sql"

echo "▸ data (public, auth, storage metadata) → $out/data.sql"
sb db dump --linked --data-only -s public,auth,storage -f "$out/data.sql"

for bucket in bookmark-pdfs bookmark-assets; do
  echo "▸ storage bucket $bucket → $out/storage/$bucket"
  # cp -r creates the bucket's own directory under the destination.
  sb storage cp --experimental --linked -r -j 4 "ss:///$bucket" "$out/storage"
done

count="$(find "$out/storage" -type f | wc -l | tr -d ' ')"
size="$(du -sh "$out" | cut -f1)"
echo "✔ backup complete: $out ($size, $count storage objects)"
