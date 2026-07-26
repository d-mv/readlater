import { describe, expect, test } from "vitest";
import { defineComponent, h, useTemplateRef } from "vue";
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

function setScrollMetrics(el: Element, { scrollTop, scrollHeight, clientHeight }: Record<string, number>) {
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
});
