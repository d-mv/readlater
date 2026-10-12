#!/usr/bin/env bash
# Runs the pgTAP database tests (supabase/tests/*.sql) against the LOCAL
# Supabase stack: start it if needed → reset the DB to the migrations →
# `supabase test db`. Local only — never touches a linked/remote project.
#
# Env:
#   SUPABASE_BIN      CLI command (default: `supabase` if on PATH, else `bunx supabase`)
#   SUPABASE_WORKDIR  project dir holding supabase/ (default: an isolated copy
#                     with its own project id and ports, see below)
#   KEEP_STACK=1      leave a stack this script started running afterwards
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# By default the tests run on their OWN stack (project_id read-later-dbtest,
# ports 553xx), never on the developer's local stack: `db reset` would wipe
# whatever that one holds. The isolated workdir gets a copy of config.toml
# with the id and ports changed, and links to the real migrations and tests.
if [[ -n "${SUPABASE_WORKDIR:-}" ]]; then
  workdir="$SUPABASE_WORKDIR"
else
  workdir="${TMPDIR:-/tmp}/read-later-dbtest"
  mkdir -p "$workdir/supabase"
  sed -E \
    -e 's/^project_id = .*/project_id = "read-later-dbtest"/' \
    -e 's/^(port|shadow_port) = 543([0-9]{2})/\1 = 553\2/' \
    "$repo_root/supabase/config.toml" >"$workdir/supabase/config.toml"
  ln -sfn "$repo_root/supabase/migrations" "$workdir/supabase/migrations"
  ln -sfn "$repo_root/supabase/tests" "$workdir/supabase/tests"
fi

if [[ -n "${SUPABASE_BIN:-}" ]]; then
  read -r -a sb <<<"$SUPABASE_BIN"
elif command -v supabase >/dev/null 2>&1; then
  sb=(supabase)
else
  sb=(bunx supabase)
fi
sb+=(--workdir "$workdir")

started=0
if ! "${sb[@]}" status >/dev/null 2>&1; then
  echo "▸ starting local Supabase stack"
  # Only what the DB tests need: Postgres + auth/storage schemas (and the
  # gateway the CLI health-checks through).
  "${sb[@]}" start -x studio,mailpit,imgproxy,edge-runtime,logflare,vector,supavisor,postgres-meta,realtime
  started=1
fi

cleanup() {
  if [[ $started -eq 1 && "${KEEP_STACK:-}" != "1" ]]; then
    echo "▸ stopping the stack this script started"
    "${sb[@]}" stop --no-backup >/dev/null
  fi
}
trap cleanup EXIT

echo "▸ resetting local database to migrations"
"${sb[@]}" db reset --local

echo "▸ running pgTAP tests"
"${sb[@]}" test db
