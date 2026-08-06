import { describe, expect, test } from "bun:test";
import { makeThumbnailUploader } from "../src/storage";

function fakeSupabase(opts: { uploadedOptions: unknown[] }) {
  return {
    storage: {
      from: (_bucket: string) => ({
        upload: (_path: string, _bytes: Uint8Array, uploadOptions: unknown) => {
          opts.uploadedOptions.push(uploadOptions);
          return Promise.resolve({ error: null });
        },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://example.test/${path}` } }),
      }),
    },
    // deno-lint-ignore no-explicit-any
  } as any;
}

describe("uploadThumbnail", () => {
  test("uploads with a long-lived cache-control, since the object path is per-upload and immutable", async () => {
    const uploadedOptions: unknown[] = [];
    const supabase = fakeSupabase({ uploadedOptions });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } }),
      )) as unknown as typeof fetch;

    try {
      await makeThumbnailUploader(supabase)("https://img.example/thumb.jpg");
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(uploadedOptions).toHaveLength(1);
    expect(uploadedOptions[0]).toMatchObject({ cacheControl: "31536000" });
  });
});
