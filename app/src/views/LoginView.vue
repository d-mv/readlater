<script setup lang="ts">
import { useRouter } from "vue-router";
import LoginForm from "../components/auth/LoginForm.vue";

const router = useRouter();

function onSuccess() {
  router.push({ name: "list" });
}
</script>

<template>
  <main class="flex min-h-screen items-center justify-center bg-canvas">
    <LoginForm @success="onSuccess" />
  </main>
</template>
