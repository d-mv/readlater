import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";
import { EXPORT_VERSION } from "../utils/dataTransfer";

const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("../lib/supabase", () => ({ supabase: { from } }));
vi.mock("../stores/auth", () => ({ useAuthStore: () => ({ userId: "user-1" }) }));

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("vue-router", () => ({ useRouter: () => ({ push }) }));

const { default: SettingsView } = await import("./SettingsView.vue");

describe("SettingsView", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:mock"),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("Back navigates to the reading list", async () => {
    const wrapper = mount(SettingsView);
    await wrapper.get('button[aria-label="Back"]').trigger("click");

    expect(push).toHaveBeenCalledWith({ name: "list" });
  });

  test("Export downloads a JSON file built from every bookmark", async () => {
    const order = vi.fn().mockResolvedValue({ data: [], error: null });
    from.mockReturnValue({ select: () => ({ order }) });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    const wrapper = mount(SettingsView);
    await wrapper.get("button.btn-primary").trigger("click");
    await flushPromises();

    expect(clickSpy).toHaveBeenCalledOnce();
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    expect(wrapper.find(".error").exists()).toBe(false);

    clickSpy.mockRestore();
  });

  test("shows an error when export fails", async () => {
    const order = vi.fn().mockResolvedValue({ data: null, error: { message: "network down" } });
    from.mockReturnValue({ select: () => ({ order }) });

    const wrapper = mount(SettingsView);
    await wrapper.get("button.btn-primary").trigger("click");
    await flushPromises();

    expect(wrapper.get(".error").text()).toBe("network down");
  });

  test("importing a file reports the imported count and any skipped rows", async () => {
    const existingSelect = vi.fn().mockResolvedValue({
      data: [{ url_normalized: "https://arc90.com/x" }],
      error: null,
    });
    const insertedSingle = vi.fn().mockResolvedValue({ data: { id: "new-1" }, error: null });
    const insert = vi.fn(() => ({ select: () => ({ single: insertedSingle }) }));
    from.mockImplementation((table: string) => {
      if (table === "bookmarks") return { select: () => existingSelect(), insert };
      throw new Error(`unexpected table ${table}`);
    });

    const payload = {
      version: EXPORT_VERSION,
      exported_at: "now",
      bookmarks: [
        {
          url: "https://new.example/y",
          type: "article",
          status: "ready",
          title: "New",
          author: null,
          excerpt: null,
          content_md: "body",
          translated_content_md: null,
          translated_lang: null,
          thumbnail_url: null,
          youtube_video_id: null,
          content_edited: false,
          word_count: 10,
          reading_time: 1,
          is_public: false,
          archived: false,
          read_at: null,
          error_message: null,
          created_at: "2026-01-01T00:00:00Z",
          processed_at: "2026-01-01T00:01:00Z",
          pdf_path: null,
          pdf_parsed: false,
          view_mode: null,
          tags: [],
        },
        {
          url: "https://arc90.com/x",
          type: "article",
          status: "ready",
          title: "Existing",
          author: null,
          excerpt: null,
          content_md: "body",
          translated_content_md: null,
          translated_lang: null,
          thumbnail_url: null,
          youtube_video_id: null,
          content_edited: false,
          word_count: 10,
          reading_time: 1,
          is_public: false,
          archived: false,
          read_at: null,
          error_message: null,
          created_at: "2026-01-01T00:00:00Z",
          processed_at: "2026-01-01T00:01:00Z",
          pdf_path: null,
          pdf_parsed: false,
          view_mode: null,
          tags: [],
        },
      ],
    };
    const file = new File([JSON.stringify(payload)], "export.json", { type: "application/json" });

    const wrapper = mount(SettingsView);
    const input = wrapper.get("input[type=file]");
    Object.defineProperty(input.element, "files", { value: [file], configurable: true });
    await input.trigger("change");
    await flushPromises();

    expect(wrapper.get(".result").text()).toContain("Imported 1 bookmark");
    expect(wrapper.get(".result").text()).toContain("Skipped 1");
    expect(wrapper.get(".skipped-list").text()).toContain("Existing");
    expect(wrapper.get(".skipped-list").text()).toContain("already exists");
  });

  test("shows an error for a file that isn't a valid export", async () => {
    const file = new File(["not json"], "export.json", { type: "application/json" });

    const wrapper = mount(SettingsView);
    const input = wrapper.get("input[type=file]");
    Object.defineProperty(input.element, "files", { value: [file], configurable: true });
    await input.trigger("change");
    await flushPromises();

    expect(wrapper.get(".error").text()).toContain("valid JSON");
  });
});
