import { describe, expect, test, vi } from "vitest";
import { mount } from "@vue/test-utils";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("vue-router", () => ({ useRouter: () => ({ push }) }));
// The real form pulls in the Supabase client; only its success event matters here.
vi.mock("../components/auth/LoginForm.vue", () => ({
  default: { name: "LoginForm", emits: ["success"], template: "<form />" },
}));

const { default: LoginView } = await import("./LoginView.vue");

describe("LoginView", () => {
  test("a successful sign-in routes to the reading list", async () => {
    const wrapper = mount(LoginView);
    expect(push).not.toHaveBeenCalled();

    wrapper.findComponent({ name: "LoginForm" }).vm.$emit("success");

    expect(push).toHaveBeenCalledWith({ name: "list" });
  });
});
