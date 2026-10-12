import { describe, expect, test } from "vitest";
import { defineComponent, effectScope, h, shallowRef, useTemplateRef, type Ref } from "vue";
import { mount } from "@vue/test-utils";
import { useScrollProgress } from "./useScrollProgress";

function mountHost() {
  const Host = defineComponent({
    setup() {
      const el = useTemplateRef<HTMLDivElement>("scroller");
      const { progress } = useScrollProgress(el);
      return () => h("div", { ref: "scroller", style: "overflow: auto" }, String(progress.value));
    },
  });
  return mount(Host);
}

function setScrollMetrics(
  el: Element,
  { scrollTop, scrollHeight, clientHeight }: Record<string, number>,
) {
  Object.defineProperty(el, "scrollTop", { value: scrollTop, configurable: true });
  Object.defineProperty(el, "scrollHeight", { value: scrollHeight, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: clientHeight, configurable: true });
}

describe("useScrollProgress", () => {
  test("starts at 0", () => {
    const wrapper = mountHost();
    expect(wrapper.text()).toBe("0");
  });

  test("reports the fraction scrolled after a scroll event", async () => {
    const wrapper = mountHost();
    const el = wrapper.element as HTMLElement;
    setScrollMetrics(el, { scrollTop: 50, scrollHeight: 200, clientHeight: 100 });

    await el.dispatchEvent(new Event("scroll"));
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toBe("0.5");
  });

  test("clamps to 1 when scrolled to the bottom", async () => {
    const wrapper = mountHost();
    const el = wrapper.element as HTMLElement;
    setScrollMetrics(el, { scrollTop: 100, scrollHeight: 200, clientHeight: 100 });

    await el.dispatchEvent(new Event("scroll"));
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toBe("1");
  });

  test("reports 0 when content doesn't overflow (no scrollable distance)", async () => {
    const wrapper = mountHost();
    const el = wrapper.element as HTMLElement;
    setScrollMetrics(el, { scrollTop: 0, scrollHeight: 100, clientHeight: 100 });

    await el.dispatchEvent(new Event("scroll"));
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toBe("0");
  });

  test("stops listening once the owner unmounts", () => {
    let progress: Ref<number> | undefined;
    const el = document.createElement("div");
    const Host = defineComponent({
      setup() {
        const target = shallowRef<HTMLElement | null>(el);
        progress = useScrollProgress(target).progress;
        return () => h("div");
      },
    });
    const wrapper = mount(Host);
    wrapper.unmount();

    setScrollMetrics(el, { scrollTop: 50, scrollHeight: 200, clientHeight: 100 });
    el.dispatchEvent(new Event("scroll"));

    expect(progress!.value).toBe(0);
  });

  test("a scroll on an element that was just detached is ignored", () => {
    const el = document.createElement("div");
    const target = shallowRef<HTMLElement | null>(el);
    const scope = effectScope();
    const { progress } = scope.run(() => useScrollProgress(target))!;

    target.value = null;
    setScrollMetrics(el, { scrollTop: 50, scrollHeight: 200, clientHeight: 100 });
    el.dispatchEvent(new Event("scroll"));

    expect(progress.value).toBe(0);
    scope.stop();
  });
});
