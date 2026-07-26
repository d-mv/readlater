function stripInlineTags(line: string): string {
  return line.replace(/<[^>]+>/g, "");
}

export function vttToPlainText(vtt: string): string {
  const lines: string[] = [];
  let lastLine: string | null = null;

  for (const rawLine of vtt.split("\n")) {
    const line = rawLine.trim();

    if (
      line.length === 0 ||
      line === "WEBVTT" ||
      line.startsWith("Kind:") ||
      line.startsWith("Language:") ||
      line.startsWith("NOTE") ||
      line.includes("-->")
    ) {
      continue;
    }

    const text = stripInlineTags(line).trim();
    if (text.length === 0 || text === lastLine) continue;

    lines.push(text);
    lastLine = text;
  }

  return lines.join(" ");
}
