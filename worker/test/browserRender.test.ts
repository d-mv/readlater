import { describe, expect, test } from "bun:test";
import { closeBrowser, browserCircuitBreaker } from "../src/browserRender";

describe("browserRender", () => {
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
