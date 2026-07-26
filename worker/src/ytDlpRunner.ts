import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { YtDlpMeta } from "./parseYoutube";

const execFileAsync = promisify(execFile);

export async function fetchMeta(url: string): Promise<YtDlpMeta> {
  const { stdout } = await execFileAsync("yt-dlp", ["--dump-json", "--skip-download", url], {
    maxBuffer: 10 * 1024 * 1024,
  });
  const json = JSON.parse(stdout);
  return {
    title: json.title,
    uploader: json.uploader,
    thumbnail: json.thumbnail,
    duration: json.duration,
  };
}

export async function fetchCaptions(url: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      "yt-dlp",
      ["--write-auto-sub", "--sub-lang", "en", "--skip-download", "-o", "-", url],
      { maxBuffer: 20 * 1024 * 1024 },
    );
    return stdout;
  } catch {
    return "";
  }
}
