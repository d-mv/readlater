export function resolveContent(converted: string, text: string): string {
  const trimmedConverted = converted.trim();
  if (trimmedConverted) return trimmedConverted;
  return text.trim();
}
