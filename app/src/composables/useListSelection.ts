import { computed, readonly, shallowRef } from "vue";

// The reading list's selection mode: which listed rows are picked for a bulk
// action. Lives as long as the list view — leaving the route forgets it.
// `listed` is the list as shown (tab, tags, search applied); a picked row
// that leaves it (archived elsewhere, filtered out) drops out of `selected`.
export function useListSelection<T extends { id: string }>(listed: () => readonly T[]) {
  const active = shallowRef(false);
  const picked = shallowRef<ReadonlySet<string>>(new Set());

  const selected = computed(() => listed().filter((row) => picked.value.has(row.id)));
  const allSelected = computed(
    () => listed().length > 0 && selected.value.length === listed().length,
  );

  function start() {
    active.value = true;
  }

  function stop() {
    active.value = false;
    picked.value = new Set();
  }

  // Picking a row starts selection mode (the `x` key does from the list).
  function toggle(id: string) {
    active.value = true;
    const next = new Set(picked.value);
    if (!next.delete(id)) next.add(id);
    picked.value = next;
  }

  function selectAll() {
    picked.value = new Set(listed().map((row) => row.id));
  }

  function isSelected(id: string): boolean {
    return picked.value.has(id);
  }

  return {
    active: readonly(active),
    selected,
    allSelected,
    start,
    stop,
    toggle,
    selectAll,
    isSelected,
  };
}
