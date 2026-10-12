# Pinned to an exact release (the version the lockfile was produced with) so a
# rebuild can't silently pick up a new Bun.
FROM oven/bun:1.3.14-slim AS base

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates tini \
  && rm -rf /var/lib/apt/lists/*

# Browsers live outside root's home so the unprivileged runtime user can use them.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
RUN bunx playwright install --with-deps chromium
COPY src ./src
COPY docker-entrypoint.sh /usr/local/bin/worker-entrypoint

# The container starts as root, but only docker-entrypoint.sh runs as root: it
# opens the Supabase key file (SUPABASE_SECRET_KEY_FILE, readable by root
# alone), passes it to the worker on fd 3 and drops to the unprivileged `bun`
# user, so the key is in no process environment and no file `bun` can read.
#
# Chromium runs with its sandbox on (browserRender.ts). Docker's default
# seccomp profile blocks the user namespaces that sandbox needs, so the
# container must run with worker/seccomp-chromium.json (Docker's default plus
# clone/unshare/setns):
#   security_opt: ["seccomp=./seccomp-chromium.json"]
# Without it the browser fallback fails to launch rather than running
# unsandboxed.

# The poll loop touches /tmp/worker-heartbeat every cycle and before each
# bookmark (a cycle waits at most 60s; a bookmark is capped at 45s). If it
# hasn't moved for 3 minutes the loop is stuck: report unhealthy.
HEALTHCHECK --interval=60s --timeout=5s --start-period=60s --retries=2 \
  CMD test -n "$(find /tmp/worker-heartbeat -mmin -3 2>/dev/null)" || exit 1

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/worker-entrypoint"]
CMD ["bun", "run", "src/index.ts"]
