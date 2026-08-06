import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "../stores/auth";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/login", name: "login", component: () => import("../views/LoginView.vue") },
    { path: "/", name: "list", component: () => import("../views/ReadingListView.vue") },
    {
      path: "/b/:id",
      name: "reader",
      component: () => import("../views/ReaderView.vue"),
      props: true,
    },
    {
      path: "/s/:id",
      name: "public",
      component: () => import("../views/PublicReaderView.vue"),
      props: true,
    },
    {
      path: "/share-target",
      name: "share-target",
      component: () => import("../views/ShareTargetView.vue"),
    },
    { path: "/capture", name: "capture", component: () => import("../views/CaptureView.vue") },
    { path: "/settings", name: "settings", component: () => import("../views/SettingsView.vue") },
  ],
});

const PUBLIC_ROUTE_NAMES = new Set(["login", "public"]);

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  // Never decide off session state before it's actually loaded — on a fresh
  // page load (e.g. a bookmarklet-opened window) this guard can otherwise
  // run before main.ts's own auth.init() resolves, misreading a real session
  // as "logged out" and redirecting away before it ever loads.
  await auth.init();
  if (!PUBLIC_ROUTE_NAMES.has(to.name as string) && !auth.isAuthenticated) return { name: "login" };
  if (to.name === "login" && auth.isAuthenticated) return { name: "list" };
  return true;
});

export default router;
