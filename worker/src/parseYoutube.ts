import { readingTimeFromDurationSeconds, wordCount } from "./reading";
import { vttToPlainText } from "./vtt";

export interface YtDlpMeta {
  title: string;
  uploader: string;
  thumbnail: string;
  duration: number;
}

export interface YoutubeRunners {
  fetchMeta: (url: string) => Promise<YtDlpMeta>;
  fetchCaptions: (url: string) => Promise<string>;
  uploadThumbnail: (thumbnailUrl: string) => Promise<string>;
}

export interface ParsedYoutube {
  title: string;
  author: string;
  thumbnail_url: string;
  content_md: string;
  word_count: number;
  reading_time: number;
}

export async function parseYoutube(url: string, runners: YoutubeRunners): Promise<ParsedYoutube> {
  const meta = await runners.fetchMeta(url);
  const captionsVtt = await runners.fetchCaptions(url);
  const transcript = vttToPlainText(captionsVtt);
  const thumbnail_url = await runners.uploadThumbnail(meta.thumbnail);

  const content_md = `# ${meta.title}\n\n![thumbnail](${thumbnail_url})\n\n${transcript}`;

  return {
    title: meta.title,
    author: meta.uploader,
    thumbnail_url,
    content_md,
    word_count: wordCount(transcript),
    reading_time: readingTimeFromDurationSeconds(meta.duration),
  };
}
