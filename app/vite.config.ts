import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
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
        background_color: "#F5F4F2",
        theme_color: "#F5F4F2",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
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
        skipWaiting: true,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
});
