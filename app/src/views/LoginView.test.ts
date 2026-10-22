import { beforeEach, describe, expect, test, vi } from "vitest";
import { mount } from "@vue/test-utils";

const { push, route } = vi.hoisted(() => ({
  push: vi.fn(),
  route: { query: {} as Record<string, unknown> },
}));
vi.mock("vue-router", () => ({ useRouter: () => ({ push }), useRoute: () => route }));
// The real form pulls in the Supabase client; only its success event matters here.
vi.mock("../components/auth/LoginForm.vue", () => ({
  default: { name: "LoginForm", emits: ["success"], template: "<form />" },
}));

const { default: LoginView } = await import("./LoginView.vue");

describe("LoginView", () => {
  beforeEach(() => {
    push.mockClear();
    route.query = {};
  });

  test("a successful sign-in routes to the reading list", async () => {
    const wrapper = mount(LoginView);
    expect(push).not.toHaveBeenCalled();

    wrapper.findComponent({ name: "LoginForm" }).vm.$emit("success");

    expect(push).toHaveBeenCalledWith({ name: "list" });
  });

  test("returns to the page that asked for the sign-in, e.g. a capture with its URL", () => {
    route.query = { redirect: "/capture?url=https%3A%2F%2Fex.com" };
    const wrapper = mount(LoginView);

    wrapper.findComponent({ name: "LoginForm" }).vm.$emit("success");

    expect(push).toHaveBeenCalledWith("/capture?url=https%3A%2F%2Fex.com");
  });

  test("ignores a redirect that leaves the app", () => {
    route.query = { redirect: "//evil.example/" };
    const wrapper = mount(LoginView);

    wrapper.findComponent({ name: "LoginForm" }).vm.$emit("success");

    expect(push).toHaveBeenCalledWith({ name: "list" });
  });
});
