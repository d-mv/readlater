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

# Run as the image's unprivileged `bun` user. Chromium still needs
# --no-sandbox (see browserRender.ts): under Docker's default seccomp profile
# its sandbox fails to start even as non-root ("Chromium sandboxing failed!",
# verified with this image), because the user namespaces it relies on are
# blocked and the setuid helper isn't shipped. Enabling it would take a custom
# seccomp profile on the container. Running non-root still limits what a
# compromised renderer could reach.
USER bun

# The poll loop touches /tmp/worker-heartbeat every cycle and before each
# bookmark (a cycle waits at most 60s; a bookmark is capped at 45s). If it
# hasn't moved for 3 minutes the loop is stuck: report unhealthy.
HEALTHCHECK --interval=60s --timeout=5s --start-period=60s --retries=2 \
  CMD test -n "$(find /tmp/worker-heartbeat -mmin -3 2>/dev/null)" || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["bun", "run", "src/index.ts"]
