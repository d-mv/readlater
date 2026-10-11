import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// md-editor-v3 (and the CodeMirror it brings, with ~100 lazily loaded language
// modes) only loads when the reader's Edit mode opens. Emitting its chunks
// under assets/editor/ lets the service worker leave them out of the precache
// (globIgnores below) and cache them on first use instead.
const EDITOR_PACKAGE =
  /node_modules\/(md-editor-v3|@codemirror\/|@lezer\/|@vavt\/|@marijn\/|@lucide\/vue|markdown-it-(image-figures|sub|sup)|medium-zoom|style-mod|w3c-keyname|crelt)/;

function isEditorChunk(moduleIds: readonly string[]): boolean {
  return moduleIds.length > 0 && moduleIds.every((id) => EDITOR_PACKAGE.test(id));
}

export default defineConfig({
  build: {
    rolldownOptions: {
      output: {
        chunkFileNames: (chunk) =>
          isEditorChunk(chunk.moduleIds)
            ? "assets/editor/[name]-[hash].js"
            : "assets/[name]-[hash].js",
        assetFileNames: (asset) =>
          asset.originalFileNames.some((name) => name.includes("md-editor-v3"))
            ? "assets/editor/[name]-[hash][extname]"
            : "assets/[name]-[hash][extname]",
      },
    },
  },
  plugins: [
    tailwindcss(),
    vue(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "icons/apple-touch-icon.png"],
      manifest: {
        name: "Read Later",
        short_name: "Read Later",
        description: "Personal read-it-later app",
        start_url: "/",
        display: "standalone",
        background_color: "#EDEAE1",
        theme_color: "#EDEAE1",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icons/maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
        // Chrome-on-Android only — WebKit/Safari has never implemented
        // share_target, so this has no effect on iOS (bookmarklet/Shortcut
        // cover capture there instead).
        share_target: {
          action: "/share-target",
          method: "GET",
          params: { title: "title", text: "text", url: "url" },
        },
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,woff2,svg,png}"],
        // Precache what the list and reader need offline. The editor, and font
        // subsets for scripts articles rarely use (Greek, Vietnamese, extended
        // Cyrillic), are cached at runtime on first use instead. Cyrillic
        // stays precached: Russian articles are read offline too.
        globIgnores: [
          "assets/editor/**",
          "assets/*-greek-*.woff2",
          "assets/*-vietnamese-*.woff2",
          "assets/*-cyrillic-ext-*.woff2",
        ],
        runtimeCaching: [
          {
            // Hashed filenames never change content, so cache-first is safe.
            urlPattern: ({ sameOrigin, url }) =>
              sameOrigin &&
              (url.pathname.startsWith("/assets/editor/") || url.pathname.endsWith(".woff2")),
            handler: "CacheFirst",
            options: {
              cacheName: "lazy-assets",
              // Bounds the cache as hashed files from older builds pile up.
              expiration: { maxEntries: 250, maxAgeSeconds: 60 * 60 * 24 * 90 },
            },
          },
        ],
        navigateFallback: "index.html",
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
});
