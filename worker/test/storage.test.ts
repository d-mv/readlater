import { describe, expect, test } from "bun:test";
import { HttpStatusError, UnsupportedContentTypeError } from "../src/errors";
import { makeThumbnailUploader } from "../src/storage";
import { BlockedUrlError } from "../src/urlGuard";

function fakeSupabase(opts: { uploadedOptions: unknown[]; paths?: string[]; uploadError?: Error }) {
  return {
    storage: {
      from: (_bucket: string) => ({
        upload: (path: string, _bytes: Uint8Array, uploadOptions: unknown) => {
          opts.uploadedOptions.push(uploadOptions);
          opts.paths?.push(path);
          return Promise.resolve({ error: opts.uploadError ?? null });
        },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://example.test/${path}` } }),
      }),
    },
    // deno-lint-ignore no-explicit-any
  } as any;
}

const publicDns = async () => ["93.184.216.34"];

function imageFetch(contentType: string, calls: RequestInit[] = []) {
  return (async (_url: string, init: RequestInit) => {
    calls.push(init);
    return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": contentType } });
  }) as unknown as typeof fetch;
}

/** A response body whose cancel() rejects, like a connection that already broke. */
function unCancellableBody(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    cancel() {
      throw new Error("cancel failed");
    },
  });
}

describe("uploadThumbnail", () => {
  test("uploads with a long-lived cache-control, since the object path is per-upload and immutable", async () => {
    const uploadedOptions: unknown[] = [];
    const paths: string[] = [];
    const calls: RequestInit[] = [];
    const upload = makeThumbnailUploader(fakeSupabase({ uploadedOptions, paths }), {
      fetchImpl: imageFetch("image/jpeg", calls),
      lookup: publicDns,
    });

    await upload("https://img.example/thumb.jpg");

    expect(uploadedOptions).toHaveLength(1);
    expect(uploadedOptions[0]).toMatchObject({
      cacheControl: "31536000",
      contentType: "image/jpeg",
    });
    expect(paths[0]).toMatch(/^youtube\/[0-9a-f-]+\.jpg$/);
    // Redirects would bypass the SSRF check, so they're refused, not followed.
    expect(calls[0]?.redirect).toBe("error");
  });

  test("refuses a thumbnail URL that resolves to a private address without fetching it", async () => {
    let fetched = 0;
    const uploadedOptions: unknown[] = [];
    const upload = makeThumbnailUploader(fakeSupabase({ uploadedOptions }), {
      fetchImpl: (async () => {
        fetched += 1;
        return new Response("x");
      }) as unknown as typeof fetch,
      lookup: async () => ["10.0.0.5"],
    });

    await expect(upload("https://thumbs.internal/x.jpg")).rejects.toBeInstanceOf(BlockedUrlError);
    expect(fetched).toBe(0);
    expect(uploadedOptions).toHaveLength(0);
  });

  test.each(["text/html", "image/svg+xml", ""])(
    "refuses a %p response instead of storing it as a thumbnail",
    async (contentType) => {
      const uploadedOptions: unknown[] = [];
      const upload = makeThumbnailUploader(fakeSupabase({ uploadedOptions }), {
        fetchImpl: imageFetch(contentType),
        lookup: publicDns,
      });

      await expect(upload("https://img.example/thumb")).rejects.toBeInstanceOf(
        UnsupportedContentTypeError,
      );
      expect(uploadedOptions).toHaveLength(0);
    },
  );

  test("a non-2xx thumbnail response fails with its status and stores nothing", async () => {
    const uploadedOptions: unknown[] = [];
    const upload = makeThumbnailUploader(fakeSupabase({ uploadedOptions }), {
      fetchImpl: (async () =>
        new Response(unCancellableBody(), {
          status: 404,
          statusText: "Not Found",
        })) as unknown as typeof fetch,
      lookup: publicDns,
    });

    const err = await upload("https://img.example/gone.jpg").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpStatusError);
    expect((err as HttpStatusError).status).toBe(404);
    expect(uploadedOptions).toHaveLength(0);
  });

  test("an unsupported type is refused even when discarding its body fails", async () => {
    const upload = makeThumbnailUploader(fakeSupabase({ uploadedOptions: [] }), {
      fetchImpl: (async () =>
        new Response(unCancellableBody(), {
          headers: { "content-type": "text/html" },
        })) as unknown as typeof fetch,
      lookup: publicDns,
    });

    await expect(upload("https://img.example/thumb")).rejects.toBeInstanceOf(
      UnsupportedContentTypeError,
    );
  });

  test("a failed Storage upload is surfaced instead of returning a URL", async () => {
    const uploadError = new Error("bucket not found");
    const upload = makeThumbnailUploader(fakeSupabase({ uploadedOptions: [], uploadError }), {
      fetchImpl: imageFetch("image/png"),
      lookup: publicDns,
    });

    await expect(upload("https://img.example/thumb.png")).rejects.toBe(uploadError);
  });

  test("returns the public URL of the stored copy", async () => {
    const paths: string[] = [];
    const upload = makeThumbnailUploader(fakeSupabase({ uploadedOptions: [], paths }), {
      fetchImpl: imageFetch("image/webp"),
      lookup: publicDns,
    });

    const url = await upload("https://img.example/thumb.webp");

    expect(paths[0]).toEndWith(".webp");
    expect(url).toBe(`https://example.test/${paths[0]}`);
  });
});
