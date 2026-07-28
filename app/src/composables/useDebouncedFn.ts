import { onUnmounted } from "vue";

export function useDebouncedFn<Args extends unknown[]>(
  fn: (...args: Args) => void,
  delayMs: number,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;

  function debounced(...args: Args) {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delayMs);
  }

  onUnmounted(() => {
    if (timer !== undefined) clearTimeout(timer);
  });

  return debounced;
}
