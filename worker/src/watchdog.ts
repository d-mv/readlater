// In-process liveness check for the poll loop. Docker's HEALTHCHECK only
// marks a stuck container unhealthy (plain compose never acts on that), so
// the worker also watches its own heartbeat and exits when it stops; with
// `restart: unless-stopped` Docker then starts a fresh container.

export interface Watchdog {
  /** Records that the loop made progress. */
  beat(): void;
  stop(): void;
}

export interface WatchdogOptions {
  /** How long the loop may go without a beat before `onStall` runs. */
  stallMs: number;
  /** How often the beat's age is checked. */
  checkEveryMs: number;
  onStall: (silentForMs: number) => void;
  now?: () => number;
  every?: (check: () => void, ms: number) => ReturnType<typeof setInterval>;
  cancel?: (timer: ReturnType<typeof setInterval>) => void;
}

export function startWatchdog(opts: WatchdogOptions): Watchdog {
  const now = opts.now ?? Date.now;
  const cancel = opts.cancel ?? ((timer) => clearInterval(timer));
  let lastBeat = now();
  let stopped = false;

  const every = opts.every ?? ((check, ms) => setInterval(check, ms));
  const timer = every(() => {
    const silentForMs = now() - lastBeat;
    if (stopped || silentForMs < opts.stallMs) return;
    stop();
    opts.onStall(silentForMs);
  }, opts.checkEveryMs);

  function stop() {
    stopped = true;
    cancel(timer);
  }

  return {
    beat: () => {
      lastBeat = now();
    },
    stop,
  };
}
