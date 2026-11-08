import { onMounted, onUnmounted } from "vue";

// Single-key shortcuts by `KeyboardEvent.key` ("j", "?", "ArrowDown"…).
export type ShortcutMap = Partial<Record<string, () => void>>;

// Where a key press is somebody typing (or a control that owns its keys),
// never a shortcut: form fields, the markdown editor (CodeMirror is
// contenteditable), and the reader's open menu (it handles its own arrows
// and Escape).
const OWNS_KEYS =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="menu"]';

function isShortcut(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.isComposing) return false;
  // Ctrl/Meta/Alt combos belong to the browser and the OS. Shift is allowed:
  // "?" is Shift+/ on most layouts.
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  const target = event.target;
  if (target instanceof Element && target.closest(OWNS_KEYS)) return false;
  // A modal dialog makes the page behind it inert; its keys are its own.
  if (document.querySelector("dialog[open]")) return false;
  return true;
}

// Listens on the document while the calling component is mounted. `active`
// switches the whole map off (the reader while editing).
export function useKeyboardShortcuts(shortcuts: ShortcutMap, active: () => boolean = () => true) {
  function onKeydown(event: KeyboardEvent) {
    const run = shortcuts[event.key];
    if (!run || !active() || !isShortcut(event)) return;
    event.preventDefault();
    run();
  }

  onMounted(() => document.addEventListener("keydown", onKeydown));
  onUnmounted(() => document.removeEventListener("keydown", onKeydown));
}
