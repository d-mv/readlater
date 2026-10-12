#!/usr/bin/env bash
# Runs the pgTAP database tests (supabase/tests/*.sql) against the LOCAL
# Supabase stack: start it if needed → reset the DB to the migrations →
# `supabase test db`. Local only — never touches a linked/remote project.
#
# Env:
#   SUPABASE_BIN      CLI command (default: `supabase` if on PATH, else `bunx supabase`)
#   SUPABASE_WORKDIR  project dir holding supabase/ (default: repo root)
#   KEEP_STACK=1      leave a stack this script started running afterwards
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
workdir="${SUPABASE_WORKDIR:-$repo_root}"

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
