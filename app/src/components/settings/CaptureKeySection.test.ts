import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";

const { from, rpc, copyText } = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  copyText: vi.fn(),
}));
vi.mock("../../lib/supabase", () => ({
  supabase: { from, rpc },
  CAPTURE_ENDPOINT: "https://project.supabase.co/functions/v1/capture",
}));
vi.mock("../../utils/clipboard", () => ({ copyText }));

const { default: CaptureKeySection } = await import("./CaptureKeySection.vue");
const { CAPTURE_KEY_LOAD_FAILED, CAPTURE_KEY_RATE_LIMITED } =
  await import("../../composables/useCaptureKey");

type Info = { created_at: string; last_used_at: string | null };
type Answer = { data: Info | null; error: { message: string } | null };

function info(answer: Answer | Promise<Answer>) {
  from.mockReturnValueOnce({ select: () => ({ maybeSingle: () => Promise.resolve(answer) }) });
}

const USED: Info = { created_at: "2026-11-01T10:00:00Z", last_used_at: "2026-11-07T08:00:00Z" };
const FRESH: Info = { created_at: "2026-11-08T12:00:00Z", last_used_at: null };
const NEW_KEY = "rlk_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abcde";

const get = (wrapper: ReturnType<typeof mount>, testId: string) =>
  wrapper.get(`[data-testid="${testId}"]`);
const has = (wrapper: ReturnType<typeof mount>, testId: string) =>
  wrapper.find(`[data-testid="${testId}"]`).exists();

enableAutoUnmount(afterEach);

describe("CaptureKeySection", () => {
  let confirm: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  test("a labelled section with a loading state until the key's dates arrive", async () => {
    let finish!: (value: Answer) => void;
    info(new Promise<Answer>((resolve) => (finish = resolve)));
    const wrapper = mount(CaptureKeySection);
    await flushPromises();

    const region = get(wrapper, "capture-key");
    expect(region.element.tagName).toBe("SECTION");
    expect(region.attributes("aria-labelledby")).toBe(wrapper.get("h2").attributes("id"));
    expect(wrapper.get("h2").text()).toBe("Capture key");
    expect(region.attributes("aria-busy")).toBe("true");
    expect(has(wrapper, "capture-key-loading")).toBe(true);
    expect(has(wrapper, "capture-key-generate")).toBe(false);

    finish({ data: USED, error: null });
    await flushPromises();
    expect(region.attributes("aria-busy")).toBe("false");
    expect(has(wrapper, "capture-key-loading")).toBe(false);
  });

  test("no key yet: says so, explains the old key retires, offers Generate key", async () => {
    info({ data: null, error: null });
    const wrapper = mount(CaptureKeySection);
    await flushPromises();

    expect(get(wrapper, "capture-key-status").text()).toMatch(/No key yet/);
    expect(get(wrapper, "capture-key-status").text()).toMatch(/turns that key off/);
    expect(get(wrapper, "capture-key-generate").text()).toBe("Generate key");
  });

  test("an existing key: created and last-used dates, and Generate new key", async () => {
    info({ data: USED, error: null });
    const wrapper = mount(CaptureKeySection);
    await flushPromises();

    const status = get(wrapper, "capture-key-status").text();
    expect(status).toMatch(/Created .*2026/);
    expect(status).toMatch(/Last used .*2026/);
    expect(get(wrapper, "capture-key-generate").text()).toBe("Generate new key");
  });

  test("a key never used says so", async () => {
    info({ data: FRESH, error: null });
    const wrapper = mount(CaptureKeySection);
    await flushPromises();
    expect(get(wrapper, "capture-key-status").text()).toMatch(/Never used/);
  });

  test("a failed read shows the error and Try again reloads", async () => {
    info({ data: null, error: { message: "boom" } });
    const wrapper = mount(CaptureKeySection);
    await flushPromises();
    expect(get(wrapper, "capture-key-error").text()).toBe(CAPTURE_KEY_LOAD_FAILED);

    info({ data: USED, error: null });
    await get(wrapper, "capture-key-retry").trigger("click");
    await flushPromises();
    expect(has(wrapper, "capture-key-error")).toBe(false);
    expect(get(wrapper, "capture-key-status").text()).toMatch(/Created/);
  });

  test("generating asks first; declining changes nothing", async () => {
    info({ data: USED, error: null });
    confirm.mockReturnValue(false);
    const wrapper = mount(CaptureKeySection);
    await flushPromises();

    await get(wrapper, "capture-key-generate").trigger("click");
    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm.mock.calls[0]![0]).toMatch(
      /The old key stops working; update it wherever you use it/,
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  test("a generated key is shown once, read-only, with copy and the Shortcut how-to", async () => {
    info({ data: USED, error: null });
    let finish!: (value: { data: unknown; error: unknown }) => void;
    rpc.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const wrapper = mount(CaptureKeySection, { attachTo: document.body });
    await flushPromises();

    await get(wrapper, "capture-key-generate").trigger("click");
    expect(rpc).toHaveBeenCalledWith("rotate_capture_key");
    expect(get(wrapper, "capture-key-generate").attributes("disabled")).toBeDefined();
    expect(get(wrapper, "capture-key-generate").text()).toBe("Generating…");

    info({ data: FRESH, error: null });
    finish({ data: NEW_KEY, error: null });
    await flushPromises();

    const field = get(wrapper, "capture-key-value");
    expect((field.element as HTMLInputElement).value).toBe(NEW_KEY);
    expect(field.attributes("readonly")).toBeDefined();
    // Labelled, and focus moves to the new key's panel so it is announced.
    const label = wrapper.get(`label[for="${field.attributes("id")}"]`);
    expect(label.text()).toBe("Your new key");
    expect(document.activeElement).toBe(get(wrapper, "capture-key-new").element);
    expect(get(wrapper, "capture-key-new").text()).toMatch(/won't be shown again/);

    const howTo = get(wrapper, "capture-key-howto").text();
    expect(howTo).toContain("https://project.supabase.co/functions/v1/capture");
    expect(howTo).toContain("Authorization");
    expect(howTo).toContain("Bearer");
    expect(get(wrapper, "capture-key-status").text()).toMatch(/Never used/);
  });

  test("copy puts the key on the clipboard and confirms for a moment", async () => {
    info({ data: USED, error: null });
    rpc.mockResolvedValue({ data: NEW_KEY, error: null });
    copyText.mockResolvedValue(undefined);
    const wrapper = mount(CaptureKeySection);
    await flushPromises();
    info({ data: FRESH, error: null });
    await get(wrapper, "capture-key-generate").trigger("click");
    await flushPromises();
    vi.useFakeTimers();

    const copy = get(wrapper, "capture-key-copy");
    expect(copy.attributes("aria-label")).toBe("Copy key");
    await copy.trigger("click");
    await flushPromises();
    expect(copyText).toHaveBeenCalledWith(NEW_KEY);
    expect(copy.find(".tabler-icon-copy-check").exists()).toBe(true);
    expect(get(wrapper, "capture-key-copied").text()).toBe("Key copied");

    await copy.trigger("click");
    await flushPromises();
    await vi.advanceTimersByTimeAsync(2000);
    expect(copy.find(".tabler-icon-copy-check").exists()).toBe(false);
    expect(get(wrapper, "capture-key-copied").text()).toBe("");
  });

  test("Done forgets the key and hides it", async () => {
    info({ data: USED, error: null });
    rpc.mockResolvedValue({ data: NEW_KEY, error: null });
    const wrapper = mount(CaptureKeySection);
    await flushPromises();
    info({ data: FRESH, error: null });
    await get(wrapper, "capture-key-generate").trigger("click");
    await flushPromises();

    await get(wrapper, "capture-key-done").trigger("click");
    expect(has(wrapper, "capture-key-new")).toBe(false);
    expect(wrapper.html()).not.toContain(NEW_KEY);
  });

  test("a refused rotation shows why and shows no key", async () => {
    info({ data: USED, error: null });
    rpc.mockResolvedValue({ data: null, error: { code: "PT429", message: "rate limit exceeded" } });
    const wrapper = mount(CaptureKeySection);
    await flushPromises();

    await get(wrapper, "capture-key-generate").trigger("click");
    await flushPromises();
    expect(get(wrapper, "capture-key-rotate-error").text()).toBe(CAPTURE_KEY_RATE_LIMITED);
    expect(has(wrapper, "capture-key-new")).toBe(false);
  });
});
