<script setup lang="ts">
import { useRouter } from "vue-router";
import LoginForm from "../components/auth/LoginForm.vue";

const router = useRouter();

function onSuccess() {
  router.push({ name: "list" });
}
</script>

<template>
  <main class="login-view">
    <LoginForm @success="onSuccess" />
  </main>
</template>

<style scoped>
.login-view {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--rl-bg);
}
</style>
