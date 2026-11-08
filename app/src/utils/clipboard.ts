// Copies text to the clipboard. The async Clipboard API needs a secure
// context and a user gesture; where it refuses (older Safari, permissions),
// a hidden textarea + execCommand("copy") still works.
export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const input = document.createElement("textarea");
    input.value = text;
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.select();
    document.execCommand("copy");
    input.remove();
  }
}
