import { beforeEach, describe, expect, test, vi } from "vitest";
import { effectScope } from "vue";

const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("../lib/supabase", () => ({ supabase: { from } }));

const {
  describeDevice,
  describeEvent,
  useSecurityEvents,
  SECURITY_EVENTS_LOAD_FAILED,
  SECURITY_EVENTS_SHOWN,
} = await import("./useSecurityEvents");
type SecurityEvent = import("./useSecurityEvents").SecurityEvent;

type Response = { data: unknown[] | null; error: { message: string } | null };

// Chainable stub for `select(...).order(...).limit(...)`.
function eventsQuery(response: Response | Promise<Response>) {
  const calls: unknown[][] = [];
  const query = {
    order: (...args: unknown[]) => {
      calls.push(["order", ...args]);
      return query;
    },
    limit: (...args: unknown[]) => {
      calls.push(["limit", ...args]);
      return Promise.resolve(response);
    },
  };
  const select = (columns: string) => {
    calls.push(["select", columns]);
    return query;
  };
  from.mockReturnValueOnce({ select });
  return calls;
}

const event = (overrides: Partial<SecurityEvent> = {}): SecurityEvent => ({
  id: 1,
  kind: "sign_in",
  detail: {},
  created_at: "2026-11-09T10:00:00Z",
  ...overrides,
});

function setup() {
  return effectScope().run(() => useSecurityEvents())!;
}

describe("useSecurityEvents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("starts loading, then reads the newest events in one query", async () => {
    const calls = eventsQuery({ data: [event()], error: null });
    const events = setup();

    expect(events.state.value).toEqual({ status: "loading" });
    await events.load();

    expect(from).toHaveBeenCalledExactlyOnceWith("security_events");
    expect(calls).toEqual([
      ["select", "id, kind, detail, created_at"],
      ["order", "created_at", { ascending: false }],
      ["limit", SECURITY_EVENTS_SHOWN],
    ]);
    expect(events.state.value).toEqual({ status: "ready", events: [event()] });
  });

  test("no rows is an empty, ready list", async () => {
    eventsQuery({ data: null, error: null });
    const events = setup();
    await events.load();
    expect(events.state.value).toEqual({ status: "ready", events: [] });
  });

  test("a refused read or a network failure is an error", async () => {
    eventsQuery({ data: null, error: { message: "denied" } });
    const events = setup();
    await events.load();
    expect(events.state.value).toEqual({
      status: "error",
      message: SECURITY_EVENTS_LOAD_FAILED,
    });

    eventsQuery(Promise.reject(new Error("offline")));
    await events.load();
    expect(events.state.value).toEqual({
      status: "error",
      message: SECURITY_EVENTS_LOAD_FAILED,
    });
  });

  test("an older load that settles last doesn't overwrite a newer one", async () => {
    let settleFirst!: (r: Response) => void;
    eventsQuery(new Promise<Response>((resolve) => (settleFirst = resolve)));
    eventsQuery({ data: [event({ id: 2 })], error: null });
    const events = setup();

    const first = events.load();
    await events.load();
    settleFirst({ data: [event({ id: 1 })], error: null });
    await first;

    expect(events.state.value).toEqual({
      status: "ready",
      events: [event({ id: 2 })],
    });
  });
});

describe("describeDevice", () => {
  test.each([
    ["Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0", "Firefox on Linux"],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Safari/537.36 Edg/142.0",
      "Edge on Windows",
    ],
    [
      "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Mobile Safari/537.36",
      "Chrome on Android",
    ],
    [
      "Mozilla/5.0 (X11; CrOS x86_64 16000.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Safari/537.36",
      "Chrome on ChromeOS",
    ],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15",
      "Safari on macOS",
    ],
    ["curl/8.7.1", null],
    ["SomeBrowser (Linux)", "Linux"],
    ["Firefox/140.0", "Firefox"],
    [undefined, null],
  ])("%s → %s", (userAgent, expected) => {
    expect(describeDevice(userAgent)).toBe(expected);
  });
});

describe("describeEvent", () => {
  test("a sign-in names the device and IP it knows", () => {
    expect(
      describeEvent(
        event({
          detail: {
            user_agent: "Gecko/20100101 Firefox/140.0 (Linux)",
            ip: "203.0.113.7",
          },
        }),
      ),
    ).toBe("Signed in · Firefox on Linux · 203.0.113.7");
    expect(describeEvent(event({ detail: { ip: "203.0.113.7" } }))).toBe("Signed in · 203.0.113.7");
    expect(describeEvent(event())).toBe("Signed in");
  });

  test("key and bookmark events", () => {
    expect(describeEvent(event({ kind: "capture_key_rotated" }))).toBe("New capture key generated");
    expect(describeEvent(event({ kind: "link_shared", detail: { title: "Bread" } }))).toBe(
      "Shared “Bread”",
    );
    expect(describeEvent(event({ kind: "link_unshared", detail: { title: "Bread" } }))).toBe(
      "Stopped sharing “Bread”",
    );
    expect(describeEvent(event({ kind: "bookmark_deleted", detail: { title: null } }))).toBe(
      "Deleted “Untitled”",
    );
  });
});
