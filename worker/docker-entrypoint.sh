#!/bin/sh
# Starts the worker as the unprivileged `bun` user without the Supabase
# service key ever being in its environment (/proc/<pid>/environ is fixed at
# exec time and readable by any process of the same user, a compromised
# Chromium included).
#
# Runs as root only to open the key: SUPABASE_SECRET_KEY_FILE (a file only
# root can read, e.g. a compose secret) or, as a fallback, the
# SUPABASE_SECRET_KEY variable, which is unset before the worker starts.
# Either way the key reaches the worker on file descriptor 3
# (SUPABASE_SECRET_KEY_FD), which it reads and closes at startup.
set -eu

if [ -n "${SUPABASE_SECRET_KEY_FILE:-}" ]; then
  exec 3<"$SUPABASE_SECRET_KEY_FILE"
  export SUPABASE_SECRET_KEY_FD=3
elif [ -n "${SUPABASE_SECRET_KEY:-}" ]; then
  exec 3<<EOF
$SUPABASE_SECRET_KEY
EOF
  export SUPABASE_SECRET_KEY_FD=3
fi
unset SUPABASE_SECRET_KEY SUPABASE_SECRET_KEY_FILE

if [ "$(id -u)" != 0 ]; then
  # Already unprivileged (compose `user:` override): nothing to drop.
  exec "$@"
fi

export HOME=/home/bun USER=bun LOGNAME=bun
exec setpriv --reuid=bun --regid=bun --init-groups \
  --inh-caps=-all --bounding-set=-all -- "$@"
