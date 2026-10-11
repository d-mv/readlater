<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref } from "vue";
import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";
import type { ToolbarNames } from "md-editor-v3";
import { IconPlayerPlayFilled } from "@tabler/icons-vue";
import { useFontSizeStore } from "../../stores/fontSize";
import { useThemeStore } from "../../stores/theme";

const MdEditor = defineAsyncComponent(() =>
  import("md-editor-v3").then((m) => {
    import("md-editor-v3/lib/style.css");
    return m.MdEditor;
  }),
);

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

// A private DOMPurify instance, so the hook below doesn't leak into any other
// DOMPurify user. Its output is the last thing touched before v-html: anything
// that edits the DOM has to happen in a hook (or before sanitizing), never by
// re-parsing sanitized HTML, which reopens the door to mutation XSS.
const purify = DOMPurify(window);

purify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    const href = node.getAttribute("href");
    // In-page anchors (footnotes) stay in the reader; everything else is an
    // external page, opened in a tab that gets no handle back to this one.
    if (href && !href.startsWith("#")) {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  } else if (node.tagName === "IMG") {
    // Long articles carry dozens of hot-linked images: fetch them as they
    // scroll into view, and decode off the main thread.
    node.setAttribute("loading", "lazy");
    node.setAttribute("decoding", "async");
  }
});

// Articles are read, not submitted: forms and their controls only serve
// phishing-style overlays, and a <style> could restyle the whole app.
const PURIFY_CONFIG = {
  FORBID_TAGS: ["form", "style", "input", "button", "textarea", "select"],
};

function sanitizeHtml(html: string): string {
  return purify.sanitize(html, PURIFY_CONFIG);
}

const isYoutube = computed(
  () => props.type === "youtube" && !!props.youtubeVideoId && !props.editing,
);
const playing = ref(false);

function sanitizeMarkdownImageLinks(markdown: string): string {
  if (!markdown) return "";
  let result = markdown.replace(
    /\[\s*(!\[[\s\S]*?\]\((?:[^()]+|\([^()]*\))*\))\s*\]\(([^)]+)\)/g,
    (_match, imgMd, href) => {
      const srcMatch = imgMd.match(/!\[[\s\S]*?\]\(([^)]+)\)/);
      const src = srcMatch ? srcMatch[1].trim() : "";
      const cleanHref = href.trim();
      if (src && cleanHref === src) {
        return imgMd;
      }
      return `[${imgMd}](${cleanHref})`;
    },
  );

  result = result.replace(/\[\s*(<img[\s\S]*?>)\s*\]\(([^)]+)\)/gi, (_match, imgHtml, href) => {
    const srcMatch = imgHtml.match(/src=["\x27]([^"\x27]+)["\x27]/i);
    const src = srcMatch ? srcMatch[1].trim() : "";
    const cleanHref = href.trim();
    if (src && cleanHref === src) {
      return imgHtml;
    }
    return `[${imgHtml}](${cleanHref})`;
  });

  return result;
}

// The worker bakes the title and thumbnail into content_md as a markdown
// heading + image — both are already shown elsewhere (title in the reader
// header, thumbnail via the click-to-play affordance above), so rendering
// content_md as-is would duplicate them.
const displayContentMd = computed(() => {
  let raw = props.contentMd ?? "";
  if (isYoutube.value) {
    raw = raw.replace(/^#\s+.*\n+/, "").replace(/^!\[thumbnail\]\([^)]*\)\n*/, "");
  }
  return sanitizeMarkdownImageLinks(raw);
});

const embedUrl = computed(() => `https://www.youtube-nocookie.com/embed/${props.youtubeVideoId}`);

// Runs on the raw rendered HTML, before sanitizing: DOMParser builds an inert
// document (no scripts run, no images load), and DOMPurify still has the last
// word on whatever this serializes.
function removeSelfImageLinks(html: string): string {
  if (!html) return html;
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const links = doc.querySelectorAll("a");
  links.forEach((a) => {
    const href = a.getAttribute("href");
    if (!href) return;
    const children = Array.from(a.childNodes).filter(
      (node) =>
        node.nodeType !== Node.TEXT_NODE || (node.textContent && node.textContent.trim() !== ""),
    );
    if (children.length === 1 && children[0].nodeName === "IMG") {
      const img = children[0] as HTMLImageElement;
      const src = img.getAttribute("src");
      if (src && href.trim() === src.trim()) {
        a.replaceWith(img);
      }
    }
  });
  return doc.body.innerHTML;
}

const safeHtml = computed(() =>
  sanitizeHtml(removeSelfImageLinks(md.render(displayContentMd.value))),
);
</script>

<template>
  <div data-testid="article" class="prose">
    <div
      v-if="isYoutube"
      class="relative mb-16 aspect-video w-full overflow-hidden rounded-sm border border-line bg-black"
    >
      <iframe
        v-if="playing"
        class="size-full border-0"
        :src="embedUrl"
        title="YouTube video player"
        allow="autoplay; encrypted-media; picture-in-picture"
        allowfullscreen
        referrerpolicy="strict-origin-when-cross-origin"
      ></iframe>
      <button
        data-testid="youtube-play"
        v-else
        class="relative block size-full cursor-pointer border-0 p-0"
        type="button"
        aria-label="Play video"
        @click="playing = true"
      >
        <img :src="thumbnailUrl ?? undefined" alt="" class="block size-full object-cover" />
        <IconPlayerPlayFilled
          :size="48"
          class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.5)]"
        />
      </button>
    </div>
    <!-- no-prettier / no-highlight: otherwise md-editor injects prettier and
         highlight.js from unpkg.com, which the CSP (nginx.conf) blocks. -->
    <MdEditor
      v-if="editing"
      :model-value="modelValue ?? ''"
      @update:model-value="emit('update:modelValue', $event)"
      :theme="themeStore.theme"
      :toolbars="editorToolbars"
      :preview="!isNarrowViewport"
      :sanitize="sanitizeHtml"
      :no-upload-img="true"
      :no-prettier="true"
      :no-highlight="true"
      :no-mermaid="true"
      :no-katex="true"
      :no-echarts="true"
      language="en-US"
      placeholder="Write in markdown…"
    />
    <template v-else-if="showPdfOriginal">
      <iframe
        v-if="pdfUrl"
        class="h-[80vh] w-full rounded-sm border border-line bg-white"
        :src="pdfUrl"
        title="PDF document"
      ></iframe>
      <p v-else class="font-sans text-base text-ink-faint">Loading PDF…</p>
    </template>
    <!-- eslint-disable-next-line vue/no-v-html -->
    <div v-else v-html="safeHtml"></div>
  </div>
</template>
