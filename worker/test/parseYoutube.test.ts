import { describe, expect, test } from "bun:test";
import { parseYoutube } from "../src/parseYoutube";

describe("parseYoutube", () => {
  test("assembles markdown from metadata and uploads the thumbnail", async () => {
    const result = await parseYoutube("https://youtu.be/abc123", {
      fetchMeta: async () => ({
        id: "abc123",
        title: "Building a resilient scraper",
        uploader: "Some Channel",
        thumbnail: "https://i.ytimg.com/vi/abc123/maxresdefault.jpg",
      }),
      uploadThumbnail: async (thumbnailUrl) => `https://storage.example.com/thumbs/${thumbnailUrl.split("/").pop()}`,
    });

    expect(result.title).toBe("Building a resilient scraper");
    expect(result.author).toBe("Some Channel");
    expect(result.youtube_video_id).toBe("abc123");
    expect(result.thumbnail_url).toBe("https://storage.example.com/thumbs/maxresdefault.jpg");
    expect(result.content_md).toContain("# Building a resilient scraper");
    expect(result.content_md).toContain("![thumbnail](https://storage.example.com/thumbs/maxresdefault.jpg)");
    expect(result.word_count).toBeNull();
    expect(result.reading_time).toBeNull();
  });
});
