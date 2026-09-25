// Shared by the file-import and pdf-import edge functions.

export function titleFromFilename(filename: string): string {
  const base = filename.replace(/\.[^./\\]+$/, "");
  return base.trim() || filename;
}

export function decodeBase64(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}
