import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";
import { MdEditor } from "md-editor-v3";
import ArticleContent from "./ArticleContent.vue";

describe("ArticleContent", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    document.documentElement.style.removeProperty("--rl-article-font-size");
    document.documentElement.dataset.theme = "";
  });

  test("applies a previously saved font size on mount, without opening the menu first", () => {
    localStorage.setItem("articleFontSize", "20");
    mount(ArticleContent, { props: { contentMd: "# Hello" } });
    expect(document.documentElement.style.getPropertyValue("--rl-article-font-size")).toBe("20px");
  });

  test("renders markdown as HTML", () => {
    const wrapper = mount(ArticleContent, {
      props: { contentMd: "# Hello\n\nSome **bold** text." },
    });
    expect(wrapper.find("h1").text()).toBe("Hello");
    expect(wrapper.find("strong").text()).toBe("bold");
  });

  test("never produces a live <script> element or an onerror-bearing element from raw-HTML-shaped input", () => {
    const wrapper = mount(ArticleContent, {
      props: { contentMd: '<script>alert(1)</script><img src=x onerror="alert(1)">' },
    });
    expect(wrapper.find("script").exists()).toBe(false);
    expect(wrapper.element.querySelector("[onerror]")).toBeNull();
  });

  test("renders raw HTML embedded in the markdown source, not just markdown syntax", () => {
    const wrapper = mount(ArticleContent, {
      props: {
        contentMd:
          '<img src="https://example.com/logo.png" style="height:64px"/>\n\n<div align="center">⁂</div>',
      },
    });
    const img = wrapper.find("img");
    expect(img.exists()).toBe(true);
    expect(img.attributes("src")).toBe("https://example.com/logo.png");
    const div = wrapper.find("div[align='center']");
    expect(div.exists()).toBe(true);
    expect(div.text()).toBe("⁂");
  });

  test("keeps HTML-shaped text inside a code span as literal text instead of parsing it as an element", () => {
    const wrapper = mount(ArticleContent, {
      props: { contentMd: 'Use `<img src="x"/>` to embed an image.' },
    });
    expect(wrapper.find("img").exists()).toBe(false);
    expect(wrapper.find("code").text()).toBe('<img src="x"/>');
  });

  test("renders nothing when content is null", () => {
    const wrapper = mount(ArticleContent, { props: { contentMd: null } });
    expect(wrapper.find(".article").html()).toContain('class="article"');
  });

  test("links open in a new tab with rel=noopener noreferrer", () => {
    const wrapper = mount(ArticleContent, {
      props: { contentMd: "[read more](https://example.com/article)" },
    });
    const link = wrapper.find("a");
    expect(link.attributes("href")).toBe("https://example.com/article");
    expect(link.attributes("target")).toBe("_blank");
    expect(link.attributes("rel")).toBe("noopener noreferrer");
  });

  describe("youtube embed", () => {
    const youtubeProps = {
      contentMd:
        "# A video\n\n![thumbnail](https://thumb.example/abc123.jpg)\n\nwelcome back to the show",
      type: "youtube" as const,
      youtubeVideoId: "abc123",
      thumbnailUrl: "https://thumb.example/abc123.jpg",
    };

    test("shows a click-to-play thumbnail and does not mount an iframe until tapped", () => {
      const wrapper = mount(ArticleContent, { props: youtubeProps });
      expect(wrapper.find("iframe").exists()).toBe(false);
      const playButton = wrapper.find("button.youtube-play");
      expect(playButton.exists()).toBe(true);
      expect(playButton.find("img").attributes("src")).toBe("https://thumb.example/abc123.jpg");
      // The thumbnail baked into content_md is redundant with the click-to-play
      // image above it, so it shouldn't render a second time.
      expect(wrapper.findAll("img")).toHaveLength(1);
      expect(wrapper.text()).toContain("welcome back to the show");
      // The title baked into content_md is redundant with the reader header's
      // own title, so it shouldn't render a second time either.
      expect(wrapper.find("h1").exists()).toBe(false);
    });

    test("tapping the thumbnail mounts a youtube-nocookie iframe pointed at the video id", async () => {
      const wrapper = mount(ArticleContent, { props: youtubeProps });
      await wrapper.find("button.youtube-play").trigger("click");
      const iframe = wrapper.find("iframe");
      expect(iframe.exists()).toBe(true);
      expect(iframe.attributes("src")).toBe("https://www.youtube-nocookie.com/embed/abc123");
      expect(wrapper.find("button.youtube-play").exists()).toBe(false);
    });

    test("non-youtube content renders without any click-to-play affordance", () => {
      const wrapper = mount(ArticleContent, { props: { contentMd: "# Hello" } });
      expect(wrapper.find("button.youtube-play").exists()).toBe(false);
      expect(wrapper.find("iframe").exists()).toBe(false);
    });

    test("youtube type without a resolved video id (older bookmark) falls back to today's rendering", () => {
      const wrapper = mount(ArticleContent, {
        props: {
          contentMd: "# A video\n\n![thumbnail](https://thumb.example/x.jpg)",
          type: "youtube",
          youtubeVideoId: null,
        },
      });
      expect(wrapper.find("button.youtube-play").exists()).toBe(false);
      expect(wrapper.find("img").attributes("src")).toBe("https://thumb.example/x.jpg");
    });
  });

  describe("pdf original view", () => {
    test("renders an iframe pointed at the signed pdfUrl when showPdfOriginal is true", () => {
      const wrapper = mount(ArticleContent, {
        props: {
          contentMd: "extracted text",
          type: "pdf",
          showPdfOriginal: true,
          pdfUrl: "https://storage.example/signed-url",
        },
      });
      const iframe = wrapper.find("iframe");
      expect(iframe.exists()).toBe(true);
      expect(iframe.attributes("src")).toBe("https://storage.example/signed-url");
      expect(wrapper.find(".article > div").exists()).toBe(false);
    });

    test("shows a loading placeholder while the signed url hasn't resolved yet", () => {
      const wrapper = mount(ArticleContent, {
        props: { contentMd: null, type: "pdf", showPdfOriginal: true, pdfUrl: null },
      });
      expect(wrapper.find("iframe").exists()).toBe(false);
      expect(wrapper.text()).toContain("Loading PDF");
    });

    test("renders the markdown view instead when showPdfOriginal is false", () => {
      const wrapper = mount(ArticleContent, {
        props: {
          contentMd: "# Extracted",
          type: "pdf",
          showPdfOriginal: false,
          pdfUrl: "https://storage.example/signed-url",
        },
      });
      expect(wrapper.find("iframe").exists()).toBe(false);
      expect(wrapper.find("h1").text()).toBe("Extracted");
    });
  });

  describe("editing", () => {
    const originalInnerWidth = window.innerWidth;

    afterEach(() => {
      window.innerWidth = originalInnerWidth;
    });

    test("renders MdEditor bound to modelValue instead of the rendered view when editing", () => {
      const wrapper = mount(ArticleContent, {
        props: { contentMd: "# saved", editing: true, modelValue: "draft text" },
      });
      const editor = wrapper.findComponent(MdEditor);
      expect(editor.exists()).toBe(true);
      expect(editor.props("modelValue")).toBe("draft text");
      expect(wrapper.find("h1").exists()).toBe(false);
    });

    test("emits update:modelValue when the editor content changes", async () => {
      const wrapper = mount(ArticleContent, {
        props: { contentMd: "# saved", editing: true, modelValue: "draft text" },
      });
      wrapper.findComponent(MdEditor).vm.$emit("update:modelValue", "changed text");
      expect(wrapper.emitted("update:modelValue")?.[0]).toEqual(["changed text"]);
    });

    test("hides the youtube click-to-play affordance while editing", () => {
      const wrapper = mount(ArticleContent, {
        props: {
          contentMd: "transcript",
          type: "youtube",
          youtubeVideoId: "abc123",
          thumbnailUrl: "https://thumb.example/abc.jpg",
          editing: true,
          modelValue: "transcript",
        },
      });
      expect(wrapper.find("button.youtube-play").exists()).toBe(false);
      expect(wrapper.find("iframe").exists()).toBe(false);
    });

    test("trims the toolbar to bold/italic/link/lists/heading/undo/redo, excluding image/table/mermaid/katex", () => {
      const wrapper = mount(ArticleContent, {
        props: { contentMd: "", editing: true, modelValue: "" },
      });
      const toolbars = wrapper.findComponent(MdEditor).props("toolbars") as string[];
      expect(toolbars).toEqual(
        expect.arrayContaining([
          "bold",
          "italic",
          "link",
          "unorderedList",
          "orderedList",
          "title",
          "revoke",
          "next",
        ]),
      );
      expect(toolbars).not.toEqual(
        expect.arrayContaining(["image", "table", "mermaid", "formula"]),
      );
    });

    test("sets the editor's toolbar and dialog language to English, not the library's zh-CN default", () => {
      const wrapper = mount(ArticleContent, {
        props: { contentMd: "", editing: true, modelValue: "" },
      });
      expect(wrapper.findComponent(MdEditor).props("language")).toBe("en-US");
    });

    test("disables image upload and mermaid/katex/echarts rendering in the editor", () => {
      const wrapper = mount(ArticleContent, {
        props: { contentMd: "", editing: true, modelValue: "" },
      });
      const editor = wrapper.findComponent(MdEditor);
      expect(editor.props("noUploadImg")).toBe(true);
      expect(editor.props("noMermaid")).toBe(true);
      expect(editor.props("noKatex")).toBe(true);
      expect(editor.props("noEcharts")).toBe(true);
    });

    test("binds the editor's theme to the app's theme store", () => {
      document.documentElement.dataset.theme = "dark";
      const wrapper = mount(ArticleContent, {
        props: { contentMd: "", editing: true, modelValue: "" },
      });
      expect(wrapper.findComponent(MdEditor).props("theme")).toBe("dark");
    });

    test("starts single-pane (no split preview) on a narrow viewport, and includes a preview toggle", () => {
      window.innerWidth = 400;
      const wrapper = mount(ArticleContent, {
        props: { contentMd: "", editing: true, modelValue: "" },
      });
      const editor = wrapper.findComponent(MdEditor);
      expect(editor.props("preview")).toBe(false);
      expect(editor.props("toolbars")).toEqual(expect.arrayContaining(["preview"]));
    });

    test("starts split-screen on a wide viewport", () => {
      window.innerWidth = 1200;
      const wrapper = mount(ArticleContent, {
        props: { contentMd: "", editing: true, modelValue: "" },
      });
      expect(wrapper.findComponent(MdEditor).props("preview")).toBe(true);
    });

    test("sanitizes the editor's live preview so raw HTML in the source can't carry an onerror/script payload", () => {
      const wrapper = mount(ArticleContent, {
        props: { contentMd: "", editing: true, modelValue: "" },
      });
      const sanitize = wrapper.findComponent(MdEditor).props("sanitize") as (
        html: string,
      ) => string;
      const sanitized = sanitize('<script>alert(1)</script><img src=x onerror="alert(1)">');
      expect(sanitized).not.toContain("onerror");
      expect(sanitized).not.toContain("<script");
    });
  });
});
