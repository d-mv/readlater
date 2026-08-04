import { describe, expect, test } from "vitest";
import { arrayBufferToBase64 } from "./base64";

describe("arrayBufferToBase64", () => {
  test("matches btoa for small input", () => {
    const buffer = new TextEncoder().encode("hello world").buffer;
    expect(arrayBufferToBase64(buffer)).toBe(btoa("hello world"));
  });

  test("round-trips through atob", () => {
    const buffer = new TextEncoder().encode("round trip me").buffer;
    const decoded = atob(arrayBufferToBase64(buffer));
    expect(decoded).toBe("round trip me");
  });

  test("handles input larger than the chunk size without throwing", () => {
    const bytes = new Uint8Array(200_000).map((_, i) => i % 256);
    const encoded = arrayBufferToBase64(bytes.buffer);
    const decoded = atob(encoded);
    expect(decoded.length).toBe(200_000);
    expect(decoded.charCodeAt(0)).toBe(0);
    expect(decoded.charCodeAt(255)).toBe(255);
  });
});
