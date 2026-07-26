<script setup lang="ts">
import { computed } from "vue";
import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";

const props = defineProps<{
  contentMd: string | null;
}>();

const md = new MarkdownIt();

const defaultLinkOpen =
  md.renderer.rules.link_open ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  token.attrSet("target", "_blank");
  token.attrSet("rel", "noopener noreferrer");
  return defaultLinkOpen(tokens, idx, options, env, self);
};

const safeHtml = computed(() =>
  DOMPurify.sanitize(md.render(props.contentMd ?? ""), { ADD_ATTR: ["target"] }),
);
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -->
  <div class="article" v-html="safeHtml"></div>
</template>

<style scoped>
.article {
  font-family: var(--rl-font-serif);
  font-size: var(--rl-article-font-size, 16px);
  line-height: 1.7;
  color: var(--rl-text-primary);
}

.article :deep(p) {
  margin: 0 0 16px;
}

.article :deep(h1),
.article :deep(h2),
.article :deep(h3) {
  font-family: var(--rl-font-ui);
  font-weight: 500;
  color: var(--rl-text-primary);
}

.article :deep(img) {
  max-width: 100%;
  border-radius: var(--rl-radius);
}

.article :deep(a) {
  color: var(--rl-accent);
}
</style>
