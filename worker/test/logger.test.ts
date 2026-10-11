import { describe, expect, spyOn, test } from "bun:test";
import { log } from "../src/logger";

describe("log", () => {
  test("writes one JSON line with level, msg and fields; errors become name: message", () => {
    const spy = spyOn(console, "error").mockImplementation(() => {});
    try {
      log.error("bookmark processing failed", {
        bookmarkId: "bm-1",
        err: new Error("boom\nline2"),
      });
      const line = String(spy.mock.calls[0]?.[0]);
      expect(line).not.toContain("\n");
      expect(JSON.parse(line)).toMatchObject({
        level: "error",
        msg: "bookmark processing failed",
        bookmarkId: "bm-1",
        err: "Error: boom\nline2",
      });
    } finally {
      spy.mockRestore();
    }
  });
});
