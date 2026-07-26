import { describe, expect, test, vi } from "vitest";
import { effectScope } from "vue";
import { useDebouncedFn } from "./useDebouncedFn";

describe("useDebouncedFn", () => {
  test("only calls the wrapped function once after the delay, with the latest args", async () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const scope = effectScope();
    const debounced = scope.run(() => useDebouncedFn(fn, 300))!;

    debounced("a");
    debounced("b");
    debounced("c");
    vi.advanceTimersByTime(299);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("c");

    scope.stop();
    vi.useRealTimers();
  });
});
