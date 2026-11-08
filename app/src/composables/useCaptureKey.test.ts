import { beforeEach, describe, expect, test, vi } from "vitest";
import { effectScope } from "vue";

const { from, rpc } = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("../lib/supabase", () => ({ supabase: { from, rpc } }));

const {
  useCaptureKey,
  CAPTURE_KEY_LOAD_FAILED,
  CAPTURE_KEY_ROTATE_FAILED,
  CAPTURE_KEY_RATE_LIMITED,
} = await import("./useCaptureKey");

type Info = { created_at: string; last_used_at: string | null };
type Answer = { data: Info | null; error: { message: string } | null };

// Stub for `from("capture_keys").select(...).maybeSingle()`.
function infoQuery(answer: Answer | Promise<Answer>) {
  const select = vi.fn(() => ({ maybeSingle: () => Promise.resolve(answer) }));
  from.mockReturnValueOnce({ select });
  return select;
}

const INFO: Info = { created_at: "2026-11-01T10:00:00Z", last_used_at: "2026-11-07T08:00:00Z" };
const FRESH: Info = { created_at: "2026-11-08T12:00:00Z", last_used_at: null };

function setup() {
  const scope = effectScope();
  const key = scope.run(() => useCaptureKey())!;
  return { key, scope };
}

describe("useCaptureKey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("loads only the key's dates — never its hash", async () => {
    const select = infoQuery({ data: INFO, error: null });
    const { key } = setup();
    expect(key.state.value).toEqual({ status: "loading" });

    await key.load();
    expect(from).toHaveBeenCalledWith("capture_keys");
    expect(select).toHaveBeenCalledWith("created_at, last_used_at");
    expect(key.state.value).toEqual({ status: "ready", key: INFO });
  });

  test("no row means no key yet", async () => {
    infoQuery({ data: null, error: null });
    const { key } = setup();
    await key.load();
    expect(key.state.value).toEqual({ status: "ready", key: null });
  });

  test("a failed or thrown read is an error state", async () => {
    infoQuery({ data: null, error: { message: "boom" } });
    const { key } = setup();
    await key.load();
    expect(key.state.value).toEqual({ status: "error", message: CAPTURE_KEY_LOAD_FAILED });

    from.mockReturnValueOnce({
      select: () => ({ maybeSingle: () => Promise.reject(new Error("offline")) }),
    });
    await key.load();
    expect(key.state.value).toEqual({ status: "error", message: CAPTURE_KEY_LOAD_FAILED });
  });

  test("rotate calls the RPC, holds the plaintext once, and refreshes the dates", async () => {
    infoQuery({ data: INFO, error: null });
    const { key } = setup();
    await key.load();

    let finish!: (value: { data: unknown; error: unknown }) => void;
    rpc.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    infoQuery({ data: FRESH, error: null });
    const pending = key.rotate();
    expect(rpc).toHaveBeenCalledWith("rotate_capture_key");
    expect(key.rotating.value).toBe(true);
    finish({ data: "rlk_new", error: null });
    await pending;

    expect(key.rotating.value).toBe(false);
    expect(key.generated.value).toBe("rlk_new");
    expect(key.rotateError.value).toBeNull();
    expect(key.state.value).toEqual({ status: "ready", key: FRESH });
  });

  test("if the refresh after a rotation fails, the new key still shows as created now, never used", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-08T12:34:56Z"), toFake: ["Date"] });
    infoQuery({ data: null, error: null });
    const { key } = setup();
    await key.load();
    rpc.mockResolvedValue({ data: "rlk_new", error: null });
    infoQuery({ data: null, error: { message: "boom" } });

    await key.rotate();
    expect(key.generated.value).toBe("rlk_new");
    expect(key.state.value).toEqual({
      status: "ready",
      key: { created_at: "2026-11-08T12:34:56.000Z", last_used_at: null },
    });
    vi.useRealTimers();
  });

  test("over the rotation limit (PT429) says so; other failures are generic; no key is held", async () => {
    infoQuery({ data: INFO, error: null });
    const { key } = setup();
    await key.load();

    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "PT429", message: "rate limit exceeded" },
    });
    await key.rotate();
    expect(key.rotateError.value).toBe(CAPTURE_KEY_RATE_LIMITED);
    expect(key.generated.value).toBeNull();

    rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "boom" } });
    await key.rotate();
    expect(key.rotateError.value).toBe(CAPTURE_KEY_ROTATE_FAILED);

    // An answer that isn't a key is a failure too.
    rpc.mockResolvedValueOnce({ data: null, error: null });
    await key.rotate();
    expect(key.rotateError.value).toBe(CAPTURE_KEY_ROTATE_FAILED);

    rpc.mockRejectedValueOnce(new Error("offline"));
    await key.rotate();
    expect(key.rotateError.value).toBe(CAPTURE_KEY_ROTATE_FAILED);
    expect(key.rotating.value).toBe(false);
    expect(key.generated.value).toBeNull();
    expect(key.state.value).toEqual({ status: "ready", key: INFO });
  });

  test("a rotation while one is in flight is ignored", async () => {
    infoQuery({ data: INFO, error: null });
    const { key } = setup();
    await key.load();
    rpc.mockReturnValue(new Promise(() => {}));
    void key.rotate();
    void key.rotate();
    expect(rpc).toHaveBeenCalledOnce();
  });

  test("a new rotation drops the key shown from the previous one first", async () => {
    infoQuery({ data: INFO, error: null });
    const { key } = setup();
    await key.load();
    rpc.mockResolvedValueOnce({ data: "rlk_one", error: null });
    infoQuery({ data: FRESH, error: null });
    await key.rotate();

    rpc.mockReturnValueOnce(new Promise(() => {}));
    void key.rotate();
    expect(key.generated.value).toBeNull();
  });

  test("dismiss and leaving the page both forget the plaintext", async () => {
    infoQuery({ data: INFO, error: null });
    const { key, scope } = setup();
    await key.load();
    rpc.mockResolvedValue({ data: "rlk_new", error: null });
    infoQuery({ data: FRESH, error: null });
    await key.rotate();

    key.dismiss();
    expect(key.generated.value).toBeNull();

    infoQuery({ data: FRESH, error: null });
    await key.rotate();
    expect(key.generated.value).toBe("rlk_new");
    scope.stop();
    expect(key.generated.value).toBeNull();
  });
});
