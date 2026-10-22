<script setup lang="ts">
import { useRoute, useRouter } from "vue-router";
import LoginForm from "../components/auth/LoginForm.vue";
import { safeRedirect } from "../utils/redirect";

const router = useRouter();
const route = useRoute();

// Back to the page that asked for the sign-in (the router guard puts it in
// ?redirect=), else the list.
function onSuccess() {
  router.push(safeRedirect(route.query.redirect) ?? { name: "list" });
}
</script>

<template>
  <main class="flex min-h-screen items-center justify-center bg-canvas">
    <LoginForm @success="onSuccess" />
  </main>
</template>
