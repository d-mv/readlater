<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";
import { MdEditor } from "md-editor-v3";
import type { ToolbarNames } from "md-editor-v3";
import "md-editor-v3/lib/style.css";
import { IconPlayerPlayFilled } from "@tabler/icons-vue";
import { useFontSizeStore } from "../../stores/fontSize";
import { useThemeStore } from "../../stores/theme";

const NARROW_VIEWPORT_BREAKPOINT = 640;
const EDITOR_TOOLBARS: ToolbarNames[] = [
  "title",
  "bold",
  "italic",
  "unorderedList",
  "orderedList",
  "link",
  "revoke",
  "next",
];

const props = defineProps<{
  contentMd: string | null;
  type?: "article" | "youtube" | "note" | "pdf";
  youtubeVideoId?: string | null;
  thumbnailUrl?: string | null;
  editing?: boolean;
  modelValue?: string;
  // PDF-only: when true, show the original PDF (via pdfUrl, a signed url
  // resolved by the parent) instead of the extracted Markdown.
  showPdfOriginal?: boolean;
  pdfUrl?: string | null;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

// Instantiating the store applies the saved font size immediately, rather than
// waiting for the reader menu (which owns FontSizeControl) to be opened first.
useFontSizeStore();
const themeStore = useThemeStore();

const isNarrowViewport = ref(window.innerWidth <= NARROW_VIEWPORT_BREAKPOINT);
const editorToolbars = computed<ToolbarNames[]>(() =>
  isNarrowViewport.value ? [...EDITOR_TOOLBARS, "preview"] : [...EDITOR_TOOLBARS],
);

function onResize() {
  isNarrowViewport.value = window.innerWidth <= NARROW_VIEWPORT_BREAKPOINT;
}

onMounted(() => window.addEventListener("resize", onResize));
onUnmounted(() => window.removeEventListener("resize", onResize));

// html: true lets raw HTML in the source (e.g. from converted Word/PDF
// uploads) pass through to the renderer instead of being escaped as text;
// DOMPurify.sanitize below still strips anything unsafe. HTML written inside
// a code span/block is unaffected — markdown-it always escapes that as
// literal text regardless of this option.
const md = new MarkdownIt({ html: true });

const defaultLinkOpen =
  md.renderer.rules.link_open ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  token.attrSet("target", "_blank");
  token.attrSet("rel", "noopener noreferrer");
  return defaultLinkOpen(tokens, idx, options, env, self);
};

const isYoutube = computed(
  () => props.type === "youtube" && !!props.youtubeVideoId && !props.editing,
);
const playing = ref(false);

// The worker bakes the title and thumbnail into content_md as a markdown
// heading + image — both are already shown elsewhere (title in the reader
// header, thumbnail via the click-to-play affordance above), so rendering
// content_md as-is would duplicate them.
const displayContentMd = computed(() => {
  if (!isYoutube.value) return props.contentMd ?? "";
  return (props.contentMd ?? "")
    .replace(/^#\s+.*\n+/, "")
    .replace(/^!\[thumbnail\]\([^)]*\)\n*/, "");
});

const embedUrl = computed(() => `https://www.youtube-nocookie.com/embed/${props.youtubeVideoId}`);

const safeHtml = computed(() =>
  DOMPurify.sanitize(md.render(displayContentMd.value), { ADD_ATTR: ["target"] }),
);
</script>

<template>
  <div class="article">
    <div v-if="isYoutube" class="youtube-embed">
      <iframe
        v-if="playing"
        class="youtube-iframe"
        :src="embedUrl"
        title="YouTube video player"
        allow="autoplay; encrypted-media; picture-in-picture"
        allowfullscreen
        referrerpolicy="strict-origin-when-cross-origin"
      ></iframe>
      <button
        v-else
        class="youtube-play"
        type="button"
        aria-label="Play video"
        @click="playing = true"
      >
        <img :src="thumbnailUrl ?? undefined" alt="" />
        <IconPlayerPlayFilled :size="48" class="youtube-play-icon" />
      </button>
    </div>
    <MdEditor
      v-if="editing"
      :model-value="modelValue ?? ''"
      @update:model-value="emit('update:modelValue', $event)"
      :theme="themeStore.theme"
      :toolbars="editorToolbars"
      :preview="!isNarrowViewport"
      :sanitize="(html: string) => DOMPurify.sanitize(html)"
      :no-upload-img="true"
      :no-mermaid="true"
      :no-katex="true"
      :no-echarts="true"
      language="en-US"
      placeholder="Write in markdown…"
    />
    <template v-else-if="showPdfOriginal">
      <iframe v-if="pdfUrl" class="pdf-frame" :src="pdfUrl" title="PDF document"></iframe>
      <p v-else class="pdf-loading">Loading PDF…</p>
    </template>
    <!-- eslint-disable-next-line vue/no-v-html -->
    <div v-else v-html="safeHtml"></div>
  </div>
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

.pdf-frame {
  width: 100%;
  height: 80vh;
  border: none;
  border-radius: var(--rl-radius);
  background: white;
}

.pdf-loading {
  font-family: var(--rl-font-ui);
  font-size: 14px;
  color: var(--rl-text-muted);
}

.youtube-embed {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  margin: 0 0 16px;
  border-radius: var(--rl-radius);
  overflow: hidden;
  background: black;
}

.youtube-iframe {
  width: 100%;
  height: 100%;
  border: none;
}

.youtube-play {
  position: relative;
  width: 100%;
  height: 100%;
  padding: 0;
  border: none;
  cursor: pointer;
  display: block;
}

.youtube-play img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.youtube-play-icon {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: white;
  filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.5));
}
</style>
