import { describe, expect, test, vi } from "vitest";
import { defineComponent, effectScope, h } from "vue";
import { mount } from "@vue/test-utils";
import { useDebouncedFn } from "./useDebouncedFn";

function mountHost(fn: (arg: string) => void) {
  const Host = defineComponent({
    setup(_, { expose }) {
      const debounced = useDebouncedFn(fn, 300);
      expose({ debounced });
      return () => h("div");
    },
  });
  return mount(Host) as unknown as { vm: { debounced: (arg: string) => void }; unmount(): void };
}

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

  test("a call still pending when the owner unmounts never fires", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const wrapper = mountHost(fn);

    wrapper.vm.debounced("late");
    wrapper.unmount();
    vi.advanceTimersByTime(1000);

    expect(fn).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  test("unmounting with nothing pending is harmless", () => {
    const fn = vi.fn();
    const wrapper = mountHost(fn);

    expect(() => wrapper.unmount()).not.toThrow();
    expect(fn).not.toHaveBeenCalled();
  });
});
