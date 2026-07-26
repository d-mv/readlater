FROM oven/bun:1-slim AS build
WORKDIR /app

# vue-tsc's module resolution breaks under Bun's Node-compat shim (the
# `node` binary this image ships is Bun itself, not real Node.js) — install
# real Node.js so the typecheck step runs the same way it does in local dev.
RUN apt-get update && apt-get install -y --no-install-recommends nodejs \
  && rm -rf /var/lib/apt/lists/*

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .

ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
RUN node node_modules/vue-tsc/bin/vue-tsc.js -b && node_modules/.bin/vite build

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
