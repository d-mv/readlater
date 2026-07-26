import { describe, expect, test, vi } from "vitest";
import { mount } from "@vue/test-utils";

const { signIn } = vi.hoisted(() => ({ signIn: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ supabase: { auth: {} } }));
vi.mock("../../stores/auth", () => ({ useAuthStore: () => ({ signIn }) }));

const { default: LoginForm } = await import("./LoginForm.vue");

describe("LoginForm", () => {
  test("submits the entered email and password to the auth store", async () => {
    signIn.mockResolvedValue({ error: null });
    const wrapper = mount(LoginForm);

    await wrapper.find("input[type=email]").setValue("me@example.com");
    await wrapper.find("input[type=password]").setValue("hunter2");
    await wrapper.find("form").trigger("submit");

    expect(signIn).toHaveBeenCalledWith("me@example.com", "hunter2");
  });

  test("emits success when signIn succeeds", async () => {
    signIn.mockResolvedValue({ error: null });
    const wrapper = mount(LoginForm);

    await wrapper.find("input[type=email]").setValue("me@example.com");
    await wrapper.find("input[type=password]").setValue("hunter2");
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(wrapper.emitted("success")).toHaveLength(1);
  });

  test("shows the error message and does not emit success on failure", async () => {
    signIn.mockResolvedValue({ error: "Invalid login credentials" });
    const wrapper = mount(LoginForm);

    await wrapper.find("input[type=email]").setValue("me@example.com");
    await wrapper.find("input[type=password]").setValue("wrong");
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(wrapper.text()).toContain("Invalid login credentials");
    expect(wrapper.emitted("success")).toBeUndefined();
  });
});

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
