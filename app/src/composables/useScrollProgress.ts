import { onUnmounted, shallowRef, watch, type Ref } from "vue";

export function useScrollProgress(target: Ref<HTMLElement | null>) {
  const progress = shallowRef(0);

  function update() {
    const el = target.value;
    if (!el) return;
    const scrollable = el.scrollHeight - el.clientHeight;
    progress.value = scrollable <= 0 ? 0 : Math.min(1, Math.max(0, el.scrollTop / scrollable));
  }

  watch(
    target,
    (el, oldEl) => {
      oldEl?.removeEventListener("scroll", update);
      el?.addEventListener("scroll", update);
      if (el) update();
    },
    { immediate: true },
  );

  onUnmounted(() => target.value?.removeEventListener("scroll", update));

  return { progress };
}
