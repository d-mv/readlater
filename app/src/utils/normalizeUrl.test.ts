import { describe, expect, test } from "vitest";
import { normalizeUrl } from "./normalizeUrl";

describe("normalizeUrl", () => {
  test("lowercases the scheme and host, and nothing else", () => {
    expect(normalizeUrl("HTTPS://Example.com/Path")).toBe("https://example.com/Path");
  });

  test("keeps the case of paths and queries, where it tells pages apart", () => {
    expect(normalizeUrl("https://bit.ly/AbC")).not.toBe(normalizeUrl("https://bit.ly/abc"));
    expect(normalizeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
  });

  test("keeps a port", () => {
    expect(normalizeUrl("HTTPS://Example.COM:8080/Q?Id=AbC")).toBe(
      "https://example.com:8080/Q?Id=AbC",
    );
  });

  test("strips one or more trailing slashes", () => {
    expect(normalizeUrl("https://example.com/path/")).toBe("https://example.com/path");
    expect(normalizeUrl("https://example.com/path///")).toBe("https://example.com/path");
    expect(normalizeUrl("HTTPS://EXAMPLE.COM/")).toBe("https://example.com");
  });

  test("leaves a string without a scheme alone, apart from trailing slashes", () => {
    expect(normalizeUrl("Not/A/URL/")).toBe("Not/A/URL");
  });
});
