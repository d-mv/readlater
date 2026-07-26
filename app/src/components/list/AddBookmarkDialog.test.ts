import { beforeEach, describe, expect, test, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";
import AddBookmarkDialog from "./AddBookmarkDialog.vue";
import { useBookmarksStore } from "../../stores/bookmarks";

const { from, getUser } = vi.hoisted(() => ({ from: vi.fn(), getUser: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ supabase: { from, auth: { getUser } } }));

describe("AddBookmarkDialog", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  test("integration: submitting the same URL twice against the real store shows the duplicate prompt", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    const inserted = {
      id: "new",
      url: "https://arc90.com/x",
      type: "article",
      status: "pending",
      archived: false,
      read_at: null,
    };
    const single = vi.fn().mockResolvedValue({ data: inserted, error: null });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    from.mockReturnValue({ insert });

    const wrapper = mount(AddBookmarkDialog);

    await wrapper.get("button.add-btn").trigger("click");
    await wrapper.get("input[type=url]").setValue("https://arc90.com/x");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(wrapper.find("dialog").exists()).toBe(false);

    await wrapper.get("button.add-btn").trigger("click");
    await wrapper.get("input[type=url]").setValue("https://arc90.com/x");
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(wrapper.text()).toContain("already saved");
    expect(insert).toHaveBeenCalledTimes(1);
  });

  test("the dialog is closed until the Add button is clicked", async () => {
    const wrapper = mount(AddBookmarkDialog);
    expect(wrapper.find("dialog").exists()).toBe(false);

    await wrapper.get("button.add-btn").trigger("click");
    expect(wrapper.find("dialog").exists()).toBe(true);
  });

  test("submitting a valid URL adds the bookmark and closes the dialog", async () => {
    const store = useBookmarksStore();
    store.add = vi.fn().mockResolvedValue({ error: null });

    const wrapper = mount(AddBookmarkDialog);
    await wrapper.get("button.add-btn").trigger("click");
    await wrapper.get("input[type=url]").setValue("https://arc90.com/x");
    await wrapper.get("form").trigger("submit");
    await wrapper.vm.$nextTick();

    expect(store.add).toHaveBeenCalledWith("https://arc90.com/x");
    expect(wrapper.find("dialog").exists()).toBe(false);
  });

  test("shows an error and keeps the dialog open when adding fails", async () => {
    const store = useBookmarksStore();
    store.add = vi.fn().mockResolvedValue({ error: "Enter a valid URL." });

    const wrapper = mount(AddBookmarkDialog);
    await wrapper.get("button.add-btn").trigger("click");
    await wrapper.get("input[type=url]").setValue("not a url");
    await wrapper.get("form").trigger("submit");
    await wrapper.vm.$nextTick();

    expect(wrapper.find("dialog").exists()).toBe(true);
    expect(wrapper.text()).toContain("Enter a valid URL.");
  });

  test("cancel closes the dialog without adding anything", async () => {
    const store = useBookmarksStore();
    store.add = vi.fn();

    const wrapper = mount(AddBookmarkDialog);
    await wrapper.get("button.add-btn").trigger("click");
    await wrapper.get("button.cancel-btn").trigger("click");

    expect(wrapper.find("dialog").exists()).toBe(false);
    expect(store.add).not.toHaveBeenCalled();
  });

  test("shows a confirmation and keeps the dialog open when the URL is a duplicate", async () => {
    const store = useBookmarksStore();
    store.add = vi.fn().mockResolvedValue({ error: null, duplicate: true });

    const wrapper = mount(AddBookmarkDialog);
    await wrapper.get("button.add-btn").trigger("click");
    await wrapper.get("input[type=url]").setValue("https://arc90.com/x");
    await wrapper.get("form").trigger("submit");
    await wrapper.vm.$nextTick();

    expect(wrapper.find("dialog").exists()).toBe(true);
    expect(wrapper.text()).toContain("already saved");
    expect(store.add).toHaveBeenCalledTimes(1);
  });

  test("confirming the duplicate prompt re-submits with force and closes on success", async () => {
    const store = useBookmarksStore();
    store.add = vi.fn().mockResolvedValue({ error: null, duplicate: true });

    const wrapper = mount(AddBookmarkDialog);
    await wrapper.get("button.add-btn").trigger("click");
    await wrapper.get("input[type=url]").setValue("https://arc90.com/x");
    await wrapper.get("form").trigger("submit");
    await wrapper.vm.$nextTick();

    store.add = vi.fn().mockResolvedValue({ error: null });
    await wrapper.get("button.confirm-btn").trigger("click");
    await wrapper.vm.$nextTick();

    expect(store.add).toHaveBeenCalledWith("https://arc90.com/x", { force: true });
    expect(wrapper.find("dialog").exists()).toBe(false);
  });

  test("defaults to URL mode, showing the URL input and not the snippet textarea", async () => {
    const wrapper = mount(AddBookmarkDialog);
    await wrapper.get("button.add-btn").trigger("click");

    expect(wrapper.find("input[type=url]").exists()).toBe(true);
    expect(wrapper.find("textarea").exists()).toBe(false);
  });

  test("switching to Snippet mode swaps the input area", async () => {
    const wrapper = mount(AddBookmarkDialog);
    await wrapper.get("button.add-btn").trigger("click");
    await wrapper.get("button.mode-snippet").trigger("click");

    expect(wrapper.find("textarea").exists()).toBe(true);
    expect(wrapper.find("input[type=url]").exists()).toBe(false);
  });

  test("switching modes clears an existing error", async () => {
    const store = useBookmarksStore();
    store.add = vi.fn().mockResolvedValue({ error: "Enter a valid URL." });

    const wrapper = mount(AddBookmarkDialog);
    await wrapper.get("button.add-btn").trigger("click");
    await wrapper.get("input[type=url]").setValue("not a url");
    await wrapper.get("form").trigger("submit");
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain("Enter a valid URL.");

    await wrapper.get("button.mode-snippet").trigger("click");

    expect(wrapper.text()).not.toContain("Enter a valid URL.");
  });

  test("the submit button is disabled until the snippet textarea has non-whitespace content", async () => {
    const wrapper = mount(AddBookmarkDialog);
    await wrapper.get("button.add-btn").trigger("click");
    await wrapper.get("button.mode-snippet").trigger("click");

    expect(wrapper.get("button.submit-btn").attributes("disabled")).toBeDefined();

    await wrapper.get("textarea").setValue("   ");
    expect(wrapper.get("button.submit-btn").attributes("disabled")).toBeDefined();

    await wrapper.get("textarea").setValue("real content");
    expect(wrapper.get("button.submit-btn").attributes("disabled")).toBeUndefined();
  });

  test("pasting rich HTML into the snippet textarea calls addSnippet with both formats on submit", async () => {
    const store = useBookmarksStore();
    store.addSnippet = vi.fn().mockResolvedValue({ error: null });

    const wrapper = mount(AddBookmarkDialog);
    await wrapper.get("button.add-btn").trigger("click");
    await wrapper.get("button.mode-snippet").trigger("click");

    const textarea = wrapper.get("textarea");
    await textarea.trigger("paste", {
      clipboardData: { getData: (type: string) => (type === "text/html" ? "<b>bold</b>" : "bold") },
    });
    await textarea.setValue("bold");
    await wrapper.get("form").trigger("submit");
    await wrapper.vm.$nextTick();

    expect(store.addSnippet).toHaveBeenCalledWith("<b>bold</b>", "bold");
    expect(wrapper.find("dialog").exists()).toBe(false);
  });

  test("typing plain text with no paste falls back to addNote on submit", async () => {
    const store = useBookmarksStore();
    store.addNote = vi.fn().mockResolvedValue({ error: null });
    store.addSnippet = vi.fn();

    const wrapper = mount(AddBookmarkDialog);
    await wrapper.get("button.add-btn").trigger("click");
    await wrapper.get("button.mode-snippet").trigger("click");
    await wrapper.get("textarea").setValue("just typed text");
    await wrapper.get("form").trigger("submit");
    await wrapper.vm.$nextTick();

    expect(store.addNote).toHaveBeenCalledWith("just typed text");
    expect(store.addSnippet).not.toHaveBeenCalled();
    expect(wrapper.find("dialog").exists()).toBe(false);
  });

  test("a paste with only text/plain (no HTML) falls back to addNote", async () => {
    const store = useBookmarksStore();
    store.addNote = vi.fn().mockResolvedValue({ error: null });
    store.addSnippet = vi.fn();

    const wrapper = mount(AddBookmarkDialog);
    await wrapper.get("button.add-btn").trigger("click");
    await wrapper.get("button.mode-snippet").trigger("click");

    const textarea = wrapper.get("textarea");
    await textarea.trigger("paste", {
      clipboardData: { getData: (type: string) => (type === "text/html" ? "" : "plain source") },
    });
    await textarea.setValue("plain source");
    await wrapper.get("form").trigger("submit");
    await wrapper.vm.$nextTick();

    expect(store.addNote).toHaveBeenCalledWith("plain source");
    expect(store.addSnippet).not.toHaveBeenCalled();
  });

  test("shows an error and keeps the dialog open when addSnippet fails", async () => {
    const store = useBookmarksStore();
    store.addSnippet = vi.fn().mockResolvedValue({ error: "snippet is empty" });

    const wrapper = mount(AddBookmarkDialog);
    await wrapper.get("button.add-btn").trigger("click");
    await wrapper.get("button.mode-snippet").trigger("click");

    const textarea = wrapper.get("textarea");
    await textarea.trigger("paste", {
      clipboardData: { getData: (type: string) => (type === "text/html" ? "<b>x</b>" : "x") },
    });
    await textarea.setValue("x");
    await wrapper.get("form").trigger("submit");
    await wrapper.vm.$nextTick();

    expect(wrapper.find("dialog").exists()).toBe(true);
    expect(wrapper.text()).toContain("snippet is empty");
  });

  test("cancelling the duplicate prompt returns to the form without adding", async () => {
    const store = useBookmarksStore();
    store.add = vi.fn().mockResolvedValue({ error: null, duplicate: true });

    const wrapper = mount(AddBookmarkDialog);
    await wrapper.get("button.add-btn").trigger("click");
    await wrapper.get("input[type=url]").setValue("https://arc90.com/x");
    await wrapper.get("form").trigger("submit");
    await wrapper.vm.$nextTick();

    await wrapper.get("button.cancel-btn").trigger("click");
    await wrapper.vm.$nextTick();

    expect(wrapper.find("dialog").exists()).toBe(true);
    expect(wrapper.find("input[type=url]").exists()).toBe(true);
    expect(store.add).toHaveBeenCalledTimes(1);
  });
});
