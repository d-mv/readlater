import { log } from "./logger";

export interface YoutubeMeta {
  id: string;
  title: string;
  uploader: string;
  thumbnail: string;
}

export interface YoutubeRunners {
  fetchMeta: (url: string) => Promise<YoutubeMeta>;
  uploadThumbnail: (thumbnailUrl: string) => Promise<string>;
}

export interface ParsedYoutube {
  title: string;
  author: string;
  youtube_video_id: string;
  thumbnail_url: string | null;
  content_md: string;
  word_count: null;
  reading_time: null;
}

export async function parseYoutube(url: string, runners: YoutubeRunners): Promise<ParsedYoutube> {
  const meta = await runners.fetchMeta(url);
  const thumbnail_url = await storeThumbnail(meta.thumbnail, runners.uploadThumbnail);

  const content_md = thumbnail_url
    ? `# ${meta.title}\n\n![thumbnail](${thumbnail_url})`
    : `# ${meta.title}`;

  return {
    title: meta.title,
    author: meta.uploader,
    youtube_video_id: meta.id,
    thumbnail_url,
    content_md,
    word_count: null,
    reading_time: null,
  };
}

// The thumbnail is decoration: a failed copy (bad type, too large, CDN down)
// must not fail the bookmark. Fall back to hot-linking the original when it's
// an http(s) URL, else go without.
async function storeThumbnail(
  thumbnail: string,
  upload: YoutubeRunners["uploadThumbnail"],
): Promise<string | null> {
  try {
    return await upload(thumbnail);
  } catch (err) {
    log.warn("thumbnail copy failed; keeping the bookmark without a stored copy", {
      thumbnail,
      err,
    });
    return /^https?:\/\//i.test(thumbnail) ? thumbnail : null;
  }
}
