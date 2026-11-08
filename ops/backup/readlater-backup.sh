#!/usr/bin/env bash
# Nightly backup of the production Supabase project, run on the VPS by
# readlater-backup.timer. Same layout as scripts/backup.sh, so
# scripts/restore.sh restores either:
#
#   <root>/<UTC stamp>/schema.sql             public schema (reference; a
#                                             restore rebuilds it from migrations)
#   <root>/<UTC stamp>/data.sql               public, auth, storage rows
#   <root>/<UTC stamp>/storage/<bucket>/...   every Storage object
#   <root>/<UTC stamp>/vault-secret-names.txt Vault secret names only —
#                                             recreate the values per
#                                             docs/architecture.md
#
# Read-only against production. pg_dump and the AWS CLI run in pinned
# containers; credentials reach them only through --env-file, never argv.
#
# Env (defaults in brackets):
#   ENV_FILE     credentials file, root-only [/etc/readlater-backup.env]
#   BACKUP_ROOT  where backups go [/var/backups/readlater]
#   KEEP_DAYS    delete backups older than this [14]
#   DOCKER_HOST_GATEWAY=1  map host.docker.internal (local test runs only)
set -euo pipefail

ENV_FILE="${ENV_FILE:-/etc/readlater-backup.env}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/readlater}"
KEEP_DAYS="${KEEP_DAYS:-14}"
PG_IMAGE="postgres:17.6-alpine"
AWS_IMAGE="amazon/aws-cli:2.31.0"
BUCKETS=(bookmark-pdfs bookmark-assets)

[[ -r "$ENV_FILE" ]] || { echo "missing $ENV_FILE (see ops/backup/backup.env.example)" >&2; exit 1; }

umask 077
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
out="$BACKUP_ROOT/$stamp.partial"
mkdir -p "$out/storage"
trap 'echo "✘ backup failed; partial output left in $out" >&2' ERR

run=(docker run --rm -i --env-file "$ENV_FILE")
if [[ "${DOCKER_HOST_GATEWAY:-}" == "1" ]]; then
  run+=(--add-host host.docker.internal:host-gateway)
fi

echo "▸ schema → schema.sql"
"${run[@]}" "$PG_IMAGE" pg_dump --schema-only --quote-all-identifier --role postgres \
  --schema public >"$out/schema.sql"

# Flags as `supabase db dump --data-only` uses them: column inserts (restore
# runs it through psql), platform-managed migration tables left out.
echo "▸ data (public, auth, storage metadata) → data.sql"
{
  echo "SET session_replication_role = replica;"
  "${run[@]}" "$PG_IMAGE" pg_dump --data-only --quote-all-identifier --role postgres \
    --exclude-table auth.schema_migrations \
    --exclude-table storage.migrations \
    --schema 'public|auth|storage' \
    --column-inserts --rows-per-insert 100000 |
    sed -E 's/^\\(un)?restrict .*$/-- &/'
  echo "RESET ALL;"
} >"$out/data.sql"

echo "▸ vault secret names → vault-secret-names.txt"
"${run[@]}" "$PG_IMAGE" psql -X -tA -v ON_ERROR_STOP=1 \
  -c "select name from vault.secrets order by name" >"$out/vault-secret-names.txt"

for bucket in "${BUCKETS[@]}"; do
  echo "▸ storage bucket $bucket"
  mkdir -p "$out/storage/$bucket"
  "${run[@]}" -v "$out/storage/$bucket:/out" "$AWS_IMAGE" \
    s3 cp --recursive --only-show-errors "s3://$bucket" /out
done

# A dump that came back empty is a failure, not a backup.
grep -q 'INSERT INTO "public"."bookmarks"' "$out/data.sql" ||
  { echo "data.sql has no bookmarks rows" >&2; false; }

mv "$out" "$BACKUP_ROOT/$stamp"
date -u +%Y-%m-%dT%H:%M:%SZ >"$BACKUP_ROOT/last-success"

# Retention: finished backups past KEEP_DAYS, and partials older than a day.
find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -name '20*' ! -name '*.partial' \
  -mtime +"$KEEP_DAYS" -exec rm -rf {} +
find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -name '*.partial' -mtime +1 -exec rm -rf {} +

count="$(find "$BACKUP_ROOT/$stamp/storage" -type f | wc -l | tr -d ' ')"
size="$(du -sh "$BACKUP_ROOT/$stamp" | cut -f1)"
echo "✔ backup complete: $BACKUP_ROOT/$stamp ($size, $count storage objects)"
