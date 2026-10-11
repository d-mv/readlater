import { describe, expect, test } from "bun:test";
import {
  browserCircuitBreaker,
  browserLaunchOptions,
  BROWSER_LAUNCH_TIMEOUT_MS,
  closeBrowser,
  CONTEXT_CLOSE_TIMEOUT_MS,
  CONTEXT_CREATE_TIMEOUT_MS,
  PAGE_CONTENT_TIMEOUT_MS,
  TOTAL_RENDER_TIMEOUT_MS,
} from "../src/browserRender";
import { BrowserUnavailableError } from "../src/errors";
import { TimeoutError } from "../src/timeout";

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

  test("page-level errors (a site that fails to load) don't trip the browser breaker", async () => {
    browserCircuitBreaker.reset();
    for (let i = 0; i < 5; i++) {
      await browserCircuitBreaker
        .execute(() => Promise.reject(new Error("page.goto: net::ERR_NAME_NOT_RESOLVED")))
        .catch(() => {});
    }
    expect(browserCircuitBreaker.getState()).toBe("CLOSED");
  });

  test.each([
    ["a dead browser", () => new BrowserUnavailableError("Browser disconnected")],
    ["a timeout", () => new TimeoutError("Extracting page content timed out")],
  ])("%s counts against the browser breaker", async (_label, makeError) => {
    browserCircuitBreaker.reset();
    for (let i = 0; i < 3; i++) {
      await browserCircuitBreaker.execute(() => Promise.reject(makeError())).catch(() => {});
    }
    expect(browserCircuitBreaker.getState()).toBe("OPEN");
    browserCircuitBreaker.reset();
  });

  test("the per-step budgets fit inside the total render timeout", () => {
    // launch + context + content + close; navigation gets whatever is left.
    expect(
      CONTEXT_CREATE_TIMEOUT_MS + PAGE_CONTENT_TIMEOUT_MS + CONTEXT_CLOSE_TIMEOUT_MS,
    ).toBeLessThan(TOTAL_RENDER_TIMEOUT_MS);
    expect(BROWSER_LAUNCH_TIMEOUT_MS).toBeLessThan(TOTAL_RENDER_TIMEOUT_MS);
  });
});

describe("browserLaunchOptions", () => {
  const env = {
    PATH: "/usr/bin",
    HOME: "/home/worker",
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SECRET_KEY: "sb_secret_do_not_leak",
  };

  test("gives Chromium a minimal environment without the worker's secrets", () => {
    const options = browserLaunchOptions("http://127.0.0.1:4000", env);
    expect(options.env).toEqual({ PATH: "/usr/bin", HOME: "/home/worker" });
    expect(JSON.stringify(options)).not.toContain("sb_secret_do_not_leak");
  });

  test("routes all browser traffic through the egress proxy, loopback included", () => {
    const options = browserLaunchOptions("http://127.0.0.1:4000", env);
    expect(options.proxy).toEqual({ server: "http://127.0.0.1:4000" });
    // No bypass list: Playwright then adds <-loopback> so localhost is proxied too.
    expect(options.proxy?.bypass).toBeUndefined();
    expect(options.args).toContain("--force-webrtc-ip-handling-policy=disable_non_proxied_udp");
  });
});
