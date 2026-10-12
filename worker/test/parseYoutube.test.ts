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
      uploadThumbnail: async (thumbnailUrl) =>
        `https://storage.example.com/thumbs/${thumbnailUrl.split("/").pop()}`,
    });

    expect(result.title).toBe("Building a resilient scraper");
    expect(result.author).toBe("Some Channel");
    expect(result.youtube_video_id).toBe("abc123");
    expect(result.thumbnail_url).toBe("https://storage.example.com/thumbs/maxresdefault.jpg");
    expect(result.content_md).toContain("# Building a resilient scraper");
    expect(result.content_md).toContain(
      "![thumbnail](https://storage.example.com/thumbs/maxresdefault.jpg)",
    );
    expect(result.word_count).toBeNull();
    expect(result.reading_time).toBeNull();
  });

  const meta = (thumbnail: string) => async () => ({
    id: "abc123",
    title: "Video",
    uploader: "Channel",
    thumbnail,
  });

  test("a failed thumbnail copy falls back to the original URL instead of failing", async () => {
    const result = await parseYoutube("https://youtu.be/abc123", {
      fetchMeta: meta("https://i.ytimg.com/vi/abc123/hq.svg"),
      uploadThumbnail: async () => {
        throw new Error("unsupported thumbnail type image/svg+xml");
      },
    });

    expect(result.thumbnail_url).toBe("https://i.ytimg.com/vi/abc123/hq.svg");
    expect(result.content_md).toBe("# Video\n\n![thumbnail](https://i.ytimg.com/vi/abc123/hq.svg)");
  });

  test("a failed copy of a non-http thumbnail leaves the bookmark without one", async () => {
    const result = await parseYoutube("https://youtu.be/abc123", {
      fetchMeta: meta("javascript:alert(1)"),
      uploadThumbnail: async () => {
        throw new Error("refused");
      },
    });

    expect(result.thumbnail_url).toBeNull();
    expect(result.content_md).toBe("# Video");
  });
});
