import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fetchWithTimeout,
  main,
  resetWorkerState,
  supabaseCircuitBreaker,
  supabaseFromEnv,
  uploadThumbnail,
  type WorkerRuntime,
} from "../src/index";
import { log } from "../src/logger";

const ENV = { SUPABASE_URL: "https://project.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_x" };

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "worker-main-"));
  supabaseCircuitBreaker.reset();
});

afterEach(() => {
  resetWorkerState();
  mock.restore();
  rmSync(dir, { recursive: true, force: true });
});

/**
 * A bookmarks table whose poll query answers with the next batch from
 * `batches` (empty once they run out). Rows of type "note" are failed by the
 * worker without any fetching, so they make a cycle "busy" offline.
 */
function queueClient(batches: unknown[][] = []) {
  let polls = 0;
  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({
          or: () => ({
            // The stale-processing sweep awaits the listing directly.
            // oxlint-disable-next-line unicorn/no-thenable
            then: (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null }),
            order: () => ({
              limit: () => {
                polls += 1;
                return Promise.resolve({ data: batches.shift() ?? [], error: null });
              },
            }),
          }),
        }),
      }),
      update: () => {
        const chain = {
          eq: () => chain,
          select: () => Promise.resolve({ data: [{ id: "x" }], error: null }),
        };
        return chain;
      },
    }),
  };
  // deno-lint-ignore no-explicit-any
  return { client: client as any, polls: () => polls };
}

/** A fake runtime whose timers are driven by the test. */
function fakeRuntime(overrides: Partial<WorkerRuntime> = {}) {
  const scheduled: { loop: () => void; ms: number; token: number }[] = [];
  const waiters: (() => void)[] = [];
  const cancelled: unknown[] = [];
  const exits: number[] = [];
  const handlers = new Map<string, () => void>();
  let browserClosed = 0;
  const runtime: Partial<WorkerRuntime> = {
    env: ENV,
    heartbeatPath: join(dir, "heartbeat"),
    schedule: (loop, ms) => {
      const token = scheduled.length + 1;
      scheduled.push({ loop, ms, token });
      waiters.shift()?.();
      return token as unknown as ReturnType<typeof setTimeout>;
    },
    cancel: (timer) => void cancelled.push(timer),
    onSignal: (signal, handler) => void handlers.set(signal, handler),
    exit: (code) => void exits.push(code),
    closeBrowserFn: async () => {
      browserClosed += 1;
    },
    ...overrides,
  };
  /** Resolves when the running cycle schedules the next one. */
  const nextSchedule = () => new Promise<void>((resolve) => waiters.push(resolve));
  /** Runs the last scheduled cycle and waits for it to schedule the next. */
  const runNext = async () => {
    const scheduledNext = nextSchedule();
    scheduled[scheduled.length - 1]!.loop();
    await scheduledNext;
  };
  return {
    runtime,
    scheduled,
    cancelled,
    exits,
    handlers,
    nextSchedule,
    runNext,
    browserClosed: () => browserClosed,
  };
}

describe("main", () => {
  test("exits with status 1 when the Supabase environment is missing", () => {
    const { client, polls } = queueClient();
    const fake = fakeRuntime({ env: { SUPABASE_URL: "https://project.supabase.co" }, client });

    main(fake.runtime);

    expect(fake.exits).toEqual([1]);
    expect(fake.scheduled).toHaveLength(0);
    expect(fake.handlers.size).toBe(0);
    expect(polls()).toBe(0);
  });

  test("polls right away, then backs off while the queue stays empty", async () => {
    const { client, polls } = queueClient([[], [], [], [{ id: "n1", type: "note", attempts: 0 }]]);
    const fake = fakeRuntime({ client });
    const first = fake.nextSchedule();

    main(fake.runtime);
    await first;
    await fake.runNext();
    await fake.runNext();

    // Empty cycles double the delay up to a minute.
    expect(fake.scheduled.map((s) => s.ms)).toEqual([30_000, 60_000, 60_000]);

    // A cycle that found work polls again at the base interval.
    await fake.runNext();
    expect(fake.scheduled.map((s) => s.ms)).toEqual([30_000, 60_000, 60_000, 15_000]);
    expect(polls()).toBe(4);
  });

  test("touches the heartbeat file around every cycle", async () => {
    const { client } = queueClient();
    const fake = fakeRuntime({ client });
    const first = fake.nextSchedule();
    const before = Date.now();

    main(fake.runtime);
    await first;

    const stamp = Number(readFileSync(join(dir, "heartbeat"), "utf8"));
    expect(stamp).toBeGreaterThanOrEqual(before);
    expect(stamp).toBeLessThanOrEqual(Date.now());
  });

  test("keeps polling when the heartbeat can't be written", async () => {
    const warn = spyOn(log, "warn");
    const { client } = queueClient();
    const fake = fakeRuntime({ client, heartbeatPath: join(dir, "missing-dir", "heartbeat") });
    const first = fake.nextSchedule();

    main(fake.runtime);
    await first;

    expect(warn).toHaveBeenCalledWith("failed to write heartbeat", expect.anything());
    expect(fake.scheduled).toHaveLength(1);
  });

  test("on SIGTERM cancels the next cycle, shuts down once and exits 0", async () => {
    const { client, polls } = queueClient();
    const fake = fakeRuntime({ client });
    const first = fake.nextSchedule();
    main(fake.runtime);
    await first;
    expect([...fake.handlers.keys()].sort()).toEqual(["SIGINT", "SIGTERM"]);

    fake.handlers.get("SIGTERM")!();
    fake.handlers.get("SIGINT")!(); // a second signal while stopping is ignored
    await Bun.sleep(0);

    expect(fake.cancelled).toEqual([fake.scheduled[0]!.token]);
    expect(fake.browserClosed()).toBe(1);
    expect(fake.exits).toEqual([0]);

    // A cycle that was already running when the signal came doesn't
    // schedule another one.
    fake.scheduled[0]!.loop();
    await Bun.sleep(0);
    expect(polls()).toBe(2);
    expect(fake.scheduled).toHaveLength(1);
  });

  describe("stall watchdog", () => {
    /** A watchdog stand-in that records beats and hands back its stall callback. */
    function fakeWatchdog() {
      const state = { beats: 0, stopped: 0, onStall: null as ((ms: number) => void) | null };
      const startWatchdog: WorkerRuntime["startWatchdog"] = (onStall) => {
        state.onStall = onStall;
        return { beat: () => void (state.beats += 1), stop: () => void (state.stopped += 1) };
      };
      return { state, startWatchdog };
    }

    test("is fed by the heartbeat around every cycle", async () => {
      const { client } = queueClient();
      const dog = fakeWatchdog();
      const fake = fakeRuntime({ client, startWatchdog: dog.startWatchdog });
      const first = fake.nextSchedule();

      main(fake.runtime);
      await first;

      expect(dog.state.beats).toBe(2);
    });

    test("a stalled loop is logged and the process exits 1 so Docker restarts it", async () => {
      const error = spyOn(log, "error");
      const { client } = queueClient();
      const dog = fakeWatchdog();
      const fake = fakeRuntime({ client, startWatchdog: dog.startWatchdog });
      const first = fake.nextSchedule();
      main(fake.runtime);
      await first;

      dog.state.onStall!(300_000);

      expect(error).toHaveBeenCalledWith(
        "poll loop stalled; exiting so the container is restarted",
        {
          silentForMs: 300_000,
        },
      );
      expect(fake.exits).toEqual([1]);
    });

    test("is stopped on SIGTERM so a slow drain can't trip it", async () => {
      const { client } = queueClient();
      const dog = fakeWatchdog();
      const fake = fakeRuntime({ client, startWatchdog: dog.startWatchdog });
      const first = fake.nextSchedule();
      main(fake.runtime);
      await first;

      fake.handlers.get("SIGTERM")!();
      await Bun.sleep(0);

      expect(dog.state.stopped).toBeGreaterThanOrEqual(1);
    });

    test("by default watches the heartbeat with a real timer", async () => {
      const { client } = queueClient();
      const fake = fakeRuntime({ client });
      const first = fake.nextSchedule();

      main(fake.runtime);
      await first;

      // resetWorkerState (afterEach) stops it; nothing has stalled yet.
      expect(fake.exits).toEqual([]);
    });
  });
});

describe("Supabase client", () => {
  test("is only created when both the URL and the secret key are set", () => {
    expect(supabaseFromEnv({})).toBeNull();
    expect(supabaseFromEnv({ SUPABASE_URL: ENV.SUPABASE_URL })).toBeNull();
    expect(supabaseFromEnv(ENV)).not.toBeNull();
  });

  test("sends every request with a timeout signal", async () => {
    const signals: (AbortSignal | null | undefined)[] = [];
    spyOn(globalThis, "fetch").mockImplementation((async (
      _input: string | URL | Request,
      init?: RequestInit,
    ) => {
      signals.push(init?.signal);
      return Response.json([]);
    }) as typeof fetch);

    await supabaseFromEnv(ENV)!.from("bookmarks").select("id");

    expect(signals).toHaveLength(1);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect(signals[0]!.aborted).toBe(false);
  });

  test("a request keeps its own abort signal alongside the timeout", async () => {
    const seen: AbortSignal[] = [];
    spyOn(globalThis, "fetch").mockImplementation((async (
      _input: string | URL | Request,
      init?: RequestInit,
    ) => {
      seen.push(init!.signal!);
      return new Response("ok");
    }) as typeof fetch);
    const caller = new AbortController();

    await fetchWithTimeout("https://project.supabase.co/rest/v1/x", { signal: caller.signal });
    caller.abort();

    expect(seen[0]).not.toBe(caller.signal);
    expect(seen[0]!.aborted).toBe(true);
  });

  test("without Supabase configured, thumbnails aren't copied", async () => {
    expect(await uploadThumbnail("https://i.ytimg.com/vi/x/hqdefault.jpg")).toBe("");
  });
});
