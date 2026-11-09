import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";

const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ supabase: { from } }));

const { default: SecurityActivitySection } = await import("./SecurityActivitySection.vue");
const { SECURITY_EVENTS_LOAD_FAILED } = await import("../../composables/useSecurityEvents");

type Response = { data: unknown[] | null; error: { message: string } | null };

function answer(response: Response | Promise<Response>) {
  from.mockReturnValueOnce({
    select: () => ({
      order: () => ({ limit: () => Promise.resolve(response) }),
    }),
  });
}

const rows = [
  {
    id: 2,
    kind: "link_shared",
    detail: { bookmark_id: "b1", title: "Bread" },
    created_at: "2026-11-09T10:00:00Z",
  },
  {
    id: 1,
    kind: "capture_key_rotated",
    detail: {},
    created_at: "2026-11-08T10:00:00Z",
  },
];

const byId = (wrapper: ReturnType<typeof mount>, testId: string) =>
  wrapper.findAll(`[data-testid="${testId}"]`);

enableAutoUnmount(afterEach);

describe("SecurityActivitySection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("is a labelled section that shows a loading state until the read settles", async () => {
    let settle!: (r: Response) => void;
    answer(new Promise<Response>((resolve) => (settle = resolve)));
    const wrapper = mount(SecurityActivitySection);
    await flushPromises();

    const section = wrapper.get('[data-testid="security-activity"]');
    const heading = wrapper.get("h2");
    expect(heading.text()).toBe("Security activity");
    expect(section.attributes("aria-labelledby")).toBe(heading.attributes("id"));
    expect(section.attributes("aria-busy")).toBe("true");
    expect(byId(wrapper, "security-activity-loading")).toHaveLength(1);

    settle({ data: rows, error: null });
    await flushPromises();
    expect(section.attributes("aria-busy")).toBe("false");
    expect(byId(wrapper, "security-activity-loading")).toHaveLength(0);
  });

  test("lists each event, newest first, with its description and time", async () => {
    answer({ data: rows, error: null });
    const wrapper = mount(SecurityActivitySection);
    await flushPromises();

    const items = byId(wrapper, "security-event");
    expect(items.map((i) => i.attributes("data-kind"))).toEqual([
      "link_shared",
      "capture_key_rotated",
    ]);
    expect(byId(wrapper, "security-event-text").map((t) => t.text())).toEqual([
      "Shared “Bread”",
      "New capture key generated",
    ]);
    const date = byId(wrapper, "security-event-date")[0]!;
    expect(date.element.tagName).toBe("TIME");
    expect(date.attributes("datetime")).toBe("2026-11-09T10:00:00Z");
    expect(date.text()).toMatch(/2026/);
  });

  test("says so when there is no activity", async () => {
    answer({ data: [], error: null });
    const wrapper = mount(SecurityActivitySection);
    await flushPromises();
    expect(wrapper.get('[data-testid="security-activity-empty"]').text()).toBe("No activity yet");
    expect(byId(wrapper, "security-event")).toHaveLength(0);
  });

  test("a failed read shows the error and Try again reloads", async () => {
    answer({ data: null, error: { message: "denied" } });
    const wrapper = mount(SecurityActivitySection);
    await flushPromises();
    expect(wrapper.get('[data-testid="security-activity-error"]').text()).toBe(
      SECURITY_EVENTS_LOAD_FAILED,
    );

    answer({ data: rows, error: null });
    await wrapper.get('[data-testid="security-activity-retry"]').trigger("click");
    await flushPromises();
    expect(byId(wrapper, "security-activity-error")).toHaveLength(0);
    expect(byId(wrapper, "security-event")).toHaveLength(2);
  });
});
