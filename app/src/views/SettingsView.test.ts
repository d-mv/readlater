import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";
import { EXPORT_VERSION } from "../utils/dataTransfer";

const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("../lib/supabase", () => ({ supabase: { from } }));
const { signOut } = vi.hoisted(() => ({ signOut: vi.fn() }));
vi.mock("../stores/auth", () => ({ useAuthStore: () => ({ userId: "user-1", signOut }) }));

const { push, replace } = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("vue-router", () => ({ useRouter: () => ({ push, replace }) }));

const { default: SettingsView } = await import("./SettingsView.vue");
const { useDataTransferStore } = await import("../stores/dataTransfer");

// Chainable stub for the store's paged `select(...).order(...).range(from, to)`.
function singlePageQuery(response: { data: unknown[] | null; error: { message: string } | null }) {
  const query = { order: () => query, range: vi.fn().mockResolvedValue(response) };
  return query;
}

describe("SettingsView", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    // Keep the real URL constructor: import validates URLs with it.
    vi.stubGlobal(
      "URL",
      Object.assign(class extends URL {}, {
        createObjectURL: vi.fn(() => "blob:mock"),
        revokeObjectURL: vi.fn(),
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("Back navigates to the reading list", async () => {
    const wrapper = mount(SettingsView);
    await wrapper.get('button[aria-label="Back"]').trigger("click");

    expect(push).toHaveBeenCalledWith({ name: "list" });
  });

  test("Sign out signs out through the store, then routes to login", async () => {
    const order: string[] = [];
    signOut.mockImplementation(async () => {
      order.push("signOut");
    });
    replace.mockImplementation(async () => {
      order.push("replace");
    });

    const wrapper = mount(SettingsView);
    await wrapper.get('[data-testid="sign-out-btn"]').trigger("click");
    await flushPromises();

    expect(signOut).toHaveBeenCalledOnce();
    expect(replace).toHaveBeenCalledWith({ name: "login" });
    expect(order).toEqual(["signOut", "replace"]);
  });

  test("Export downloads a JSON file built from every bookmark", async () => {
    from.mockReturnValue({ select: () => singlePageQuery({ data: [], error: null }) });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    const wrapper = mount(SettingsView);
    await wrapper.get('[data-testid="export-btn"]').trigger("click");
    await flushPromises();

    expect(clickSpy).toHaveBeenCalledOnce();
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    expect(wrapper.find('[data-testid="error"]').exists()).toBe(false);

    clickSpy.mockRestore();
  });

  test("shows an error when export fails", async () => {
    from.mockReturnValue({
      select: () => singlePageQuery({ data: null, error: { message: "network down" } }),
    });

    const wrapper = mount(SettingsView);
    await wrapper.get('[data-testid="export-btn"]').trigger("click");
    await flushPromises();

    expect(wrapper.get('[data-testid="error"]').text()).toBe("network down");
  });

  test("importing a file reports the imported count and any skipped rows", async () => {
    const existingQuery = singlePageQuery({
      data: [{ url_normalized: "https://arc90.com/x" }],
      error: null,
    });
    const insert = vi.fn(() => ({
      select: vi.fn().mockResolvedValue({ data: [{ id: "new-1" }], error: null }),
    }));
    from.mockImplementation((table: string) => {
      if (table === "bookmarks") return { select: () => existingQuery, insert };
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

    expect(wrapper.get('[data-testid="result"]').text()).toContain("Imported 1 bookmark");
    expect(wrapper.get('[data-testid="result"]').text()).toContain("Skipped 1");
    expect(wrapper.get('[data-testid="skipped-list"]').text()).toContain("Existing");
    expect(wrapper.get('[data-testid="skipped-list"]').text()).toContain("already exists");
  });

  test("shows a generic error when export returns no payload", async () => {
    const wrapper = mount(SettingsView);
    vi.spyOn(useDataTransferStore(), "exportBookmarks").mockResolvedValue({
      payload: null,
      error: null,
    });
    await wrapper.get('[data-testid="export-btn"]').trigger("click");
    await flushPromises();

    expect(wrapper.get('[data-testid="error"]').text()).toBe("Export failed.");
  });

  test("Choose file opens the hidden file picker", async () => {
    const wrapper = mount(SettingsView);
    const pick = vi.spyOn(wrapper.get("input[type=file]").element as HTMLInputElement, "click");

    const chooseFile = wrapper.findAll("button").find((b) => b.text().includes("Choose file"));
    await chooseFile!.trigger("click");

    expect(pick).toHaveBeenCalledOnce();
  });

  test("closing the picker without choosing a file does nothing", async () => {
    const wrapper = mount(SettingsView);
    const input = wrapper.get("input[type=file]");
    Object.defineProperty(input.element, "files", { value: [], configurable: true });
    await input.trigger("change");
    await flushPromises();

    expect(from).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="result"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="error"]').exists()).toBe(false);
  });

  test("lists invalid rows by URL, or as Untitled when they have neither title nor URL", async () => {
    from.mockReturnValue({ select: () => singlePageQuery({ data: [], error: null }) });
    const payload = {
      version: EXPORT_VERSION,
      exported_at: "now",
      bookmarks: [{ url: "https://broken.example/z" }, 42],
    };
    const file = new File([JSON.stringify(payload)], "export.json", { type: "application/json" });

    const wrapper = mount(SettingsView);
    const input = wrapper.get("input[type=file]");
    Object.defineProperty(input.element, "files", { value: [file], configurable: true });
    await input.trigger("change");
    await flushPromises();

    expect(wrapper.get('[data-testid="result"]').text()).toContain("Imported 0 bookmarks.");
    const rows = wrapper.findAll('[data-testid="skipped-list"] li').map((li) => li.text());
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatch(/^https:\/\/broken\.example\/z — invalid row/);
    expect(rows[1]).toMatch(/^Untitled — invalid row/);
  });

  test("shows an error for a file that isn't a valid export", async () => {
    const file = new File(["not json"], "export.json", { type: "application/json" });

    const wrapper = mount(SettingsView);
    const input = wrapper.get("input[type=file]");
    Object.defineProperty(input.element, "files", { value: [file], configurable: true });
    await input.trigger("change");
    await flushPromises();

    expect(wrapper.get('[data-testid="error"]').text()).toContain("valid JSON");
  });
});
