import { describe, expect, test } from "bun:test";
import { parseYoutube } from "../src/parseYoutube";

const SAMPLE_VTT = [
  "WEBVTT",
  "",
  "00:00:00.000 --> 00:00:02.000 align:start position:0%",
  "welcome back to the show",
  "",
].join("\n");

describe("parseYoutube", () => {
  test("assembles markdown from metadata + transcript, uploads the thumbnail, and derives reading time from duration", async () => {
    const result = await parseYoutube("https://youtu.be/abc123", {
      fetchMeta: async () => ({
        id: "abc123",
        title: "Building a resilient scraper",
        uploader: "Some Channel",
        thumbnail: "https://i.ytimg.com/vi/abc123/maxresdefault.jpg",
        duration: 1080,
      }),
      fetchCaptions: async () => SAMPLE_VTT,
      uploadThumbnail: async (thumbnailUrl) => `https://storage.example.com/thumbs/${thumbnailUrl.split("/").pop()}`,
    });

    expect(result.title).toBe("Building a resilient scraper");
    expect(result.author).toBe("Some Channel");
    expect(result.youtube_video_id).toBe("abc123");
    expect(result.thumbnail_url).toBe("https://storage.example.com/thumbs/maxresdefault.jpg");
    expect(result.content_md).toContain("# Building a resilient scraper");
    expect(result.content_md).toContain("![thumbnail](https://storage.example.com/thumbs/maxresdefault.jpg)");
    expect(result.content_md).toContain("welcome back to the show");
    expect(result.reading_time).toBe(18);
  });

  test("still produces content_md when a video has no captions available", async () => {
    const result = await parseYoutube("https://youtu.be/xyz", {
      fetchMeta: async () => ({
        id: "xyz",
        title: "Silent video",
        uploader: "Someone",
        thumbnail: "https://i.ytimg.com/vi/xyz/maxresdefault.jpg",
        duration: 30,
      }),
      fetchCaptions: async () => "",
      uploadThumbnail: async () => "https://storage.example.com/thumbs/xyz.jpg",
    });

    expect(result.youtube_video_id).toBe("xyz");
    expect(result.content_md).toContain("# Silent video");
    expect(result.reading_time).toBe(1);
  });
});
