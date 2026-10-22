import { watch } from "vue";
import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "../stores/auth";
import { safeRedirect } from "../utils/redirect";

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

// The guard below only runs on navigation. A login that ends mid-visit —
// sign-out here or in another tab, a session found expired by a fetch — has
// to leave the protected page too. Set up once per auth store (the store
// needs an active Pinia, which doesn't exist yet when this module loads).
const watchedStores = new WeakSet<object>();
function leaveWhenSignedOut(auth: ReturnType<typeof useAuthStore>) {
  if (watchedStores.has(auth)) return;
  watchedStores.add(auth);
  watch(
    () => auth.isAuthenticated,
    (signedIn) => {
      const current = router.currentRoute.value.name;
      if (!signedIn && !PUBLIC_ROUTE_NAMES.has(current as string)) {
        void router.replace({ name: "login" });
      }
    },
  );
}

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  // Never decide off session state before it's actually loaded — on a fresh
  // page load (e.g. a bookmarklet-opened window) this guard can otherwise
  // run before main.ts's own auth.init() resolves, misreading a real session
  // as "logged out" and redirecting away before it ever loads.
  await auth.init();
  leaveWhenSignedOut(auth);
  if (!PUBLIC_ROUTE_NAMES.has(to.name as string) && !auth.isAuthenticated) {
    // The way back after signing in — a bookmarklet capture or a shared
    // link would otherwise lose its URL and text.
    return { name: "login", query: to.fullPath === "/" ? {} : { redirect: to.fullPath } };
  }
  if (to.name === "login" && auth.isAuthenticated) {
    return safeRedirect(to.query.redirect) ?? { name: "list" };
  }
  return true;
});

export default router;
