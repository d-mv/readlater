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

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["bun", "run", "src/index.ts"]
