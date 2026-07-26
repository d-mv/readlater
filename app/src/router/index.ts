import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "../stores/auth";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/login", name: "login", component: () => import("../views/LoginView.vue") },
    { path: "/", name: "list", component: () => import("../views/ReadingListView.vue") },
    { path: "/b/:id", name: "reader", component: () => import("../views/ReaderView.vue"), props: true },
    { path: "/s/:id", name: "public", component: () => import("../views/PublicReaderView.vue"), props: true },
    { path: "/share-target", name: "share-target", component: () => import("../views/ShareTargetView.vue") },
  ],
});

const PUBLIC_ROUTE_NAMES = new Set(["login", "public"]);

router.beforeEach((to) => {
  const auth = useAuthStore();
  if (!PUBLIC_ROUTE_NAMES.has(to.name as string) && !auth.isAuthenticated) return { name: "login" };
  if (to.name === "login" && auth.isAuthenticated) return { name: "list" };
  return true;
});

export default router;
