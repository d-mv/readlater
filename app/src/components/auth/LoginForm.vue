<script setup lang="ts">
import { shallowRef } from "vue";
import { useAuthStore } from "../../stores/auth";
import Button from "../../shared/ui/Button.vue";
import Input from "../../shared/ui/Input.vue";
import Message from "../../shared/ui/Message.vue";

const emit = defineEmits<{
  success: [];
}>();

const auth = useAuthStore();

const email = shallowRef("");
const password = shallowRef("");
const error = shallowRef<string | null>(null);
const submitting = shallowRef(false);

async function onSubmit() {
  submitting.value = true;
  error.value = null;
  try {
    const result = await auth.signIn(email.value, password.value);
    if (result.error) {
      error.value = result.error;
      return;
    }
    emit("success");
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <form class="mx-auto max-w-320 px-24 py-40" @submit.prevent="onSubmit">
    <p class="m-0 mb-4 text-center text-lg font-medium text-ink">Read Later</p>
    <p class="m-0 mb-24 text-center text-sm text-ink-muted">Sign in to your archive</p>

    <label class="mb-4 block text-xs text-ink-muted" for="email">Email</label>
    <Input
      id="email"
      v-model="email"
      type="email"
      placeholder="you@example.com"
      class="mb-12 bg-raised"
    />

    <label class="mb-4 block text-xs text-ink-muted" for="password">Password</label>
    <Input
      id="password"
      v-model="password"
      type="password"
      placeholder="••••••••"
      class="mb-12 bg-raised"
    />

    <Message v-if="error" tone="accent" test-id="error" class="-mt-4 mb-12">{{ error }}</Message>

    <Button type="submit" size="lg" class="w-full px-6" :disabled="submitting">Sign in</Button>
  </form>
</template>
