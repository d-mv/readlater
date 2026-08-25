import "./assets/main.css";
import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import router from "./router";
import { useAuthStore } from "./stores/auth";

// Automatically reload the page if a dynamically imported chunk fails to load
// (e.g. after a new deployment updates asset hashes on the server).
window.addEventListener("vite:preloadError", () => {
  window.location.reload();
});

const app = createApp(App);

app.use(createPinia());
app.use(router);

const auth = useAuthStore();
await auth.init();

app.mount("#app");
