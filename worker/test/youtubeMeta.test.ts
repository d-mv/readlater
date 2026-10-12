import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { HttpStatusError } from "../src/errors";
import { USER_AGENT } from "../src/http";
import { fetchMeta, youtubeCircuitBreaker } from "../src/youtubeMeta";

let requests: { url: string; init: RequestInit | undefined }[] = [];
let respond: () => Response;

beforeEach(() => {
  requests = [];
  respond = () =>
    Response.json({
      title: "A video",
      author_name: "A channel",
      thumbnail_url: "https://i.ytimg.com/vi/abc123/hqdefault.jpg",
    });
  youtubeCircuitBreaker.reset();
  spyOn(globalThis, "fetch").mockImplementation((async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    requests.push({ url: String(input), init });
    return respond();
  }) as typeof fetch);
});

afterEach(() => {
  mock.restore();
  youtubeCircuitBreaker.reset();
});

describe("fetchMeta", () => {
  test("asks YouTube's oEmbed endpoint for the video, as the worker's user agent", async () => {
    const url = "https://www.youtube.com/watch?v=abc123&t=10";

    const meta = await fetchMeta(url);

    expect(meta).toEqual({
      id: "abc123",
      title: "A video",
      uploader: "A channel",
      thumbnail: "https://i.ytimg.com/vi/abc123/hqdefault.jpg",
    });
    expect(requests).toHaveLength(1);
    const requested = new URL(requests[0]!.url);
    expect(requested.origin + requested.pathname).toBe("https://www.youtube.com/oembed");
    expect(requested.searchParams.get("url")).toBe(url);
    expect(requested.searchParams.get("format")).toBe("json");
    expect(new Headers(requests[0]!.init?.headers).get("User-Agent")).toBe(USER_AGENT);
    expect(requests[0]!.init?.signal).toBeInstanceOf(AbortSignal);
  });

  test.each([
    ["a short link", "https://youtu.be/short1"],
    ["an embed URL", "https://www.youtube.com/embed/short1?start=3"],
    ["a Shorts URL", "https://www.youtube.com/shorts/short1"],
  ])("extracts the video id from %s", async (_label, url) => {
    expect((await fetchMeta(url)).id).toBe("short1");
  });

  test("fails when the URL carries no video id", async () => {
    await expect(fetchMeta("https://www.youtube.com/@somechannel")).rejects.toThrow(
      "could not extract video id",
    );
  });

  test("strips null bytes and defaults missing fields to empty strings", async () => {
    respond = () => Response.json({ title: "Bad\u0000 title" });

    expect(await fetchMeta("https://youtu.be/x1")).toEqual({
      id: "x1",
      title: "Bad title",
      uploader: "",
      thumbnail: "",
    });
  });

  test("a 4xx (private or removed video) fails without tripping the breaker", async () => {
    respond = () => new Response("Not Found", { status: 404 });

    for (let i = 0; i < 3; i++) {
      const err = await fetchMeta("https://youtu.be/gone").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(HttpStatusError);
      expect((err as HttpStatusError).status).toBe(404);
    }
    expect(youtubeCircuitBreaker.getState()).toBe("CLOSED");
  });

  test("repeated 5xx answers open the breaker, which then fails fast without fetching", async () => {
    respond = () => new Response("oops", { status: 503 });

    for (let i = 0; i < 3; i++) {
      await expect(fetchMeta("https://youtu.be/x1")).rejects.toBeInstanceOf(HttpStatusError);
    }
    expect(youtubeCircuitBreaker.getState()).toBe("OPEN");

    await expect(fetchMeta("https://youtu.be/x1")).rejects.toThrow("is OPEN");
    expect(requests).toHaveLength(3);
  });
});
