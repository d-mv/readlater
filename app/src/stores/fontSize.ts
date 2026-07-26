import { defineStore } from "pinia";
import { computed, shallowRef } from "vue";

const STORAGE_KEY = "articleFontSize";
const CSS_VAR = "--rl-article-font-size";
const MIN_FONT_SIZE = 14;
const MAX_FONT_SIZE = 24;
const DEFAULT_FONT_SIZE = 16;
const STEP = 2;

function clamp(size: number) {
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, size));
}

function readStored(): number {
  const stored = Number(localStorage.getItem(STORAGE_KEY));
  return Number.isFinite(stored) && stored > 0 ? clamp(stored) : DEFAULT_FONT_SIZE;
}

export const useFontSizeStore = defineStore("fontSize", () => {
  const fontSize = shallowRef(readStored());
  document.documentElement.style.setProperty(CSS_VAR, `${fontSize.value}px`);

  const canIncrease = computed(() => fontSize.value < MAX_FONT_SIZE);
  const canDecrease = computed(() => fontSize.value > MIN_FONT_SIZE);

  function apply(next: number) {
    fontSize.value = clamp(next);
    document.documentElement.style.setProperty(CSS_VAR, `${fontSize.value}px`);
    localStorage.setItem(STORAGE_KEY, String(fontSize.value));
  }

  function increase() {
    apply(fontSize.value + STEP);
  }

  function decrease() {
    apply(fontSize.value - STEP);
  }

  return { fontSize, canIncrease, canDecrease, increase, decrease };
});
