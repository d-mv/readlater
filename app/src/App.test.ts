import { describe, expect, test } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia } from "pinia";
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

    const wrapper = mount(App, { global: { plugins: [router, createPinia()] } });

    expect(wrapper.text()).toBe("current page");
    // The undo toast lives at app level, outside the routed page.
    expect(wrapper.find('[data-testid="undo-toast"]').exists()).toBe(true);
  });
});
