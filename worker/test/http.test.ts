import { describe, expect, test } from "bun:test";
import { ResponseTooLargeError } from "../src/errors";
import { mediaType, readBodyCapped } from "../src/http";

/** A body that yields `chunks`, then stays open; cancelling it fails. */
function stubbornBody(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let next = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[next++];
      if (chunk) controller.enqueue(chunk);
    },
    cancel() {
      throw new Error("cancel failed");
    },
  });
}

describe("mediaType", () => {
  test("lowercases the type and drops its parameters", () => {
    const res = new Response("", { headers: { "content-type": "Text/HTML ; charset=UTF-8" } });
    expect(mediaType(res)).toBe("text/html");
  });

  test("is empty when the response declares no type", () => {
    expect(mediaType(new Response(null))).toBe("");
  });
});

describe("readBodyCapped", () => {
  test("joins a body streamed in several chunks", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array([3]));
        controller.close();
      },
    });

    expect(await readBodyCapped(new Response(body), 10)).toEqual(new Uint8Array([1, 2, 3]));
  });

  test("returns an empty array for a response without a body", async () => {
    expect(await readBodyCapped(new Response(null), 10)).toEqual(new Uint8Array());
  });

  test("a body that is exactly at the cap is accepted", async () => {
    const res = new Response(new Uint8Array(4), { headers: { "content-length": "4" } });
    expect((await readBodyCapped(res, 4)).byteLength).toBe(4);
  });

  test("a declared length over the cap is refused even if cancelling the body fails", async () => {
    const res = new Response(stubbornBody([new Uint8Array(1)]), {
      headers: { "content-length": "11" },
    });

    await expect(readBodyCapped(res, 10)).rejects.toBeInstanceOf(ResponseTooLargeError);
  });

  test("a body that streams past the cap is refused even if cancelling it fails", async () => {
    const res = new Response(stubbornBody([new Uint8Array(6), new Uint8Array(6)]));

    await expect(readBodyCapped(res, 10)).rejects.toBeInstanceOf(ResponseTooLargeError);
  });
});
