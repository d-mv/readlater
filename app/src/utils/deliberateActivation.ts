// /capture and /share-target save what another page or app hands them, so a
// save must be something the user meant. A page that opens the capture popup
// from a keydown can ask the user to keep pressing Enter; those presses land
// in the popup. So the buttons aren't focused on load, and a keyboard
// activation (a click event with detail 0) right after a prompt appears is
// ignored. A pointer click counts at once, and a keyboard user who tabs to
// the button is past the grace period by then.
export const KEY_ACTIVATION_GRACE_MS = 500;

export function isDeliberateActivation(
  event: MouseEvent,
  promptShownAt: number,
  now: number = performance.now(),
): boolean {
  return event.detail > 0 || now - promptShownAt >= KEY_ACTIVATION_GRACE_MS;
}
