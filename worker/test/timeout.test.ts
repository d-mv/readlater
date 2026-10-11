import { describe, expect, test } from "bun:test";
import { TimeoutError, withTimeout } from "../src/timeout";

describe("withTimeout", () => {
  test("resolves if promise completes before timeout", async () => {
    const res = await withTimeout(Promise.resolve("ok"), 1000, "timed out");
    expect(res).toBe("ok");
  });

  test("rejects with a TimeoutError if promise exceeds timeout", async () => {
    const slowPromise = new Promise((resolve) => setTimeout(resolve, 200));
    const err = await withTimeout(slowPromise, 30, "timed out").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TimeoutError);
    expect((err as Error).message).toBe("timed out");
    expect((err as Error).name).toBe("TimeoutError");
  });
});
