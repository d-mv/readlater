import { describe, expect, test } from "vitest";
import { mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { defineComponent, h } from "vue";
import App from "./App.vue";

describe("App", () => {
  test("renders the page for the current route", async () => {
    const Page = defineComponent({ render: () => h("p", "current page") });
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/", component: Page }],
    });
    await router.push("/");

    const wrapper = mount(App, { global: { plugins: [router] } });

    expect(wrapper.text()).toBe("current page");
  });
});
