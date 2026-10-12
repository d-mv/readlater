#!/usr/bin/env bash
# Restores a backup made by scripts/backup.sh into a database whose schema is
# already at the same migrations (a fresh project after `sb db push`, or a
# local stack after `db reset`). Replaces ALL rows in public, auth and the
# storage metadata tables.
#
#   bash scripts/restore.sh <backup dir> <postgres URL>
#
# Refuses a hosted (*.supabase.co / pooler) URL unless RESTORE_TO_HOSTED=1,
# so a slip can't overwrite production. Storage objects are uploaded
# separately (printed at the end) because they live in the Storage API, not
# in Postgres.
set -euo pipefail

backup="${1:?usage: restore.sh <backup dir> <postgres URL>}"
db_url="${2:?usage: restore.sh <backup dir> <postgres URL>}"

[[ -f "$backup/data.sql" ]] || { echo "no data.sql in $backup" >&2; exit 1; }
if [[ "$db_url" =~ supabase\.(co|com) && "${RESTORE_TO_HOSTED:-}" != "1" ]]; then
  echo "refusing to restore into a hosted database; set RESTORE_TO_HOSTED=1 to confirm" >&2
  exit 1
fi

echo "▸ clearing existing rows and loading $backup/data.sql"
# One transaction: either the whole backup lands or nothing changes. Triggers
# are off (replica) so tombstones/updated_at bumps don't fire during the load.
# Buckets are created by the migrations and re-inserted by the dump.
psql "$db_url" -q -v ON_ERROR_STOP=1 --single-transaction \
  -c "set session_replication_role = replica" \
  -c "truncate auth.users cascade" \
  -c "delete from storage.objects" \
  -c "delete from storage.buckets" \
  -c "truncate public.bookmark_deletions, public.rate_limits" \
  -f "$backup/data.sql"

psql "$db_url" -tA -c "select 'bookmarks=' || (select count(*) from public.bookmarks)
  || ' tags=' || (select count(*) from public.tags)
  || ' users=' || (select count(*) from auth.users)
  || ' storage objects=' || (select count(*) from storage.objects)"

cat <<EOF
✔ database restored. Upload the Storage objects to the target project:
  for b in bookmark-pdfs bookmark-assets; do
    sb storage cp --experimental --linked -r "$backup/storage/\$b" ss:///
  done
EOF
