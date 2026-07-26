<script setup lang="ts">
import { shallowRef } from "vue";
import { useAuthStore } from "../../stores/auth";

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
  <form class="login-form" @submit.prevent="onSubmit">
    <p class="brand">Read Later</p>
    <p class="subtitle">Sign in to your archive</p>

    <label class="field-label" for="email">Email</label>
    <input id="email" v-model="email" type="email" placeholder="you@example.com" class="field-input" />

    <label class="field-label" for="password">Password</label>
    <input id="password" v-model="password" type="password" placeholder="••••••••" class="field-input" />

    <p v-if="error" class="error">{{ error }}</p>

    <button class="submit" type="submit" :disabled="submitting">Sign in</button>
  </form>
</template>

<style scoped>
.login-form {
  max-width: 320px;
  margin: 0 auto;
  padding: 40px 24px;
}

.brand {
  font-size: 18px;
  font-weight: 500;
  color: var(--rl-text-primary);
  text-align: center;
  margin: 0 0 4px;
}

.subtitle {
  font-size: 13px;
  color: var(--rl-text-secondary);
  text-align: center;
  margin: 0 0 24px;
}

.field-label {
  font-size: 12px;
  color: var(--rl-text-secondary);
  display: block;
  margin-bottom: 4px;
}

.field-input {
  width: 100%;
  height: 40px;
  border-radius: var(--rl-radius);
  border: 0.5px solid var(--rl-border);
  background: var(--rl-surface);
  color: var(--rl-text-primary);
  padding: 0 12px;
  font-size: 14px;
  margin-bottom: 12px;
  box-sizing: border-box;
}

.error {
  color: var(--rl-accent);
  font-size: 13px;
  margin: -4px 0 12px;
}

.submit {
  width: 100%;
  height: 40px;
  border-radius: var(--rl-radius);
  border: none;
  background: var(--rl-accent);
  color: var(--rl-on-accent);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}

.submit:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
