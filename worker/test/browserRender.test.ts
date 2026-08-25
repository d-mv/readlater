import { describe, expect, test } from "bun:test";
import { promiseWithTimeout, closeBrowser, browserCircuitBreaker } from "../src/browserRender";

describe("browserRender helper timeouts", () => {
  test("promiseWithTimeout resolves when target promise completes in time", async () => {
    const res = await promiseWithTimeout(Promise.resolve("rendered"), 500, "timed out");
    expect(res).toBe("rendered");
  });

  test("promiseWithTimeout rejects with specified error message when timeout is exceeded", async () => {
    const slow = new Promise((resolve) => setTimeout(resolve, 200));
    await expect(promiseWithTimeout(slow, 30, "Render timed out after 30ms")).rejects.toThrow(
      "Render timed out after 30ms",
    );
  });

  test("closeBrowser safely resets browser state without throwing", async () => {
    await expect(closeBrowser()).resolves.toBeUndefined();
  });

  test("browserCircuitBreaker tracks failure and trips open", async () => {
    browserCircuitBreaker.reset();
    expect(browserCircuitBreaker.getState()).toBe("CLOSED");

    // 1st failure
    browserCircuitBreaker.recordFailure();
    expect(browserCircuitBreaker.getState()).toBe("CLOSED");

    // 2nd failure
    browserCircuitBreaker.recordFailure();
    expect(browserCircuitBreaker.getState()).toBe("CLOSED");

    // 3rd failure - trips to OPEN
    browserCircuitBreaker.recordFailure();
    expect(browserCircuitBreaker.getState()).toBe("OPEN");

    browserCircuitBreaker.reset();
    expect(browserCircuitBreaker.getState()).toBe("CLOSED");
  });
});
