import { describe, expect, test } from "bun:test";
import { startWatchdog } from "../src/watchdog";

/** A clock and an interval driven by the test. */
function fakeTimers() {
  let time = 1_000;
  const checks: (() => void)[] = [];
  const cancelled: unknown[] = [];
  return {
    now: () => time,
    advance: (ms: number) => {
      time += ms;
      for (const check of [...checks]) check();
    },
    every: (check: () => void, ms: number) => {
      checks.push(check);
      return ms as unknown as ReturnType<typeof setInterval>;
    },
    cancel: (timer: ReturnType<typeof setInterval>) => void cancelled.push(timer),
    cancelled,
  };
}

describe("startWatchdog", () => {
  test("stays quiet while beats keep coming", () => {
    const timers = fakeTimers();
    const stalls: number[] = [];
    const dog = startWatchdog({
      stallMs: 100,
      checkEveryMs: 10,
      onStall: (ms) => stalls.push(ms),
      ...timers,
    });

    for (let i = 0; i < 20; i += 1) {
      timers.advance(60);
      dog.beat();
    }

    expect(stalls).toEqual([]);
  });

  test("reports a stall once, with how long the loop was silent, and stops", () => {
    const timers = fakeTimers();
    const stalls: number[] = [];
    startWatchdog({ stallMs: 100, checkEveryMs: 10, onStall: (ms) => stalls.push(ms), ...timers });

    timers.advance(99);
    expect(stalls).toEqual([]);
    timers.advance(1);
    timers.advance(500);

    expect(stalls).toEqual([100]);
    expect(timers.cancelled).toEqual([10]);
  });

  test("a stopped watchdog never reports", () => {
    const timers = fakeTimers();
    const stalls: number[] = [];
    const dog = startWatchdog({
      stallMs: 100,
      checkEveryMs: 10,
      onStall: (ms) => stalls.push(ms),
      ...timers,
    });

    dog.stop();
    timers.advance(1_000);

    expect(stalls).toEqual([]);
    expect(timers.cancelled).toEqual([10]);
  });

  test("uses real timers by default", async () => {
    const stalls: number[] = [];
    const dog = startWatchdog({ stallMs: 20, checkEveryMs: 5, onStall: (ms) => stalls.push(ms) });

    await Bun.sleep(60);
    dog.stop();

    expect(stalls).toHaveLength(1);
    expect(stalls[0]).toBeGreaterThanOrEqual(20);
  });
});
