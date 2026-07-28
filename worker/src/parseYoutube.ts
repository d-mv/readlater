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
  thumbnail_url: string;
  content_md: string;
  word_count: null;
  reading_time: null;
}

export async function parseYoutube(url: string, runners: YoutubeRunners): Promise<ParsedYoutube> {
  const meta = await runners.fetchMeta(url);
  const thumbnail_url = await runners.uploadThumbnail(meta.thumbnail);

  const content_md = `# ${meta.title}\n\n![thumbnail](${thumbnail_url})`;

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
