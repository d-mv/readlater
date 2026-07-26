import { describe, expect, test } from "vitest";
import { mount } from "@vue/test-utils";
import ArticleContent from "./ArticleContent.vue";

describe("ArticleContent", () => {
  test("renders markdown as HTML", () => {
    const wrapper = mount(ArticleContent, { props: { contentMd: "# Hello\n\nSome **bold** text." } });
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
});
