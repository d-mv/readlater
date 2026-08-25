export class CircuitBreakerOpenError extends Error {
  constructor(
    public readonly breakerName: string,
    public readonly resetAfterMs: number,
  ) {
    super(
      `Circuit breaker '${breakerName}' is OPEN. Fast-failing request (retry in ${Math.ceil(resetAfterMs / 1000)}s).`,
    );
    this.name = "CircuitBreakerOpenError";
  }
}

export type CircuitBreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerOptions {
  name?: string;
  failureThreshold?: number;
  resetTimeoutMs?: number;
  onStateChange?: (from: CircuitBreakerState, to: CircuitBreakerState) => void;
}

export class CircuitBreaker {
  private state: CircuitBreakerState = "CLOSED";
  private failureCount = 0;
  private nextAttemptTime = 0;
  public readonly name: string;
  public readonly failureThreshold: number;
  public readonly resetTimeoutMs: number;
  private readonly onStateChange?: (from: CircuitBreakerState, to: CircuitBreakerState) => void;

  constructor(options: CircuitBreakerOptions = {}) {
    this.name = options.name ?? "default";
    this.failureThreshold = options.failureThreshold ?? 3;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 30_000;
    this.onStateChange = options.onStateChange;
  }

  getState(): CircuitBreakerState {
    if (this.state === "OPEN" && Date.now() >= this.nextAttemptTime) {
      this.transitionTo("HALF_OPEN");
    }
    return this.state;
  }

  async execute<T>(action: () => Promise<T>): Promise<T> {
    const currentState = this.getState();

    if (currentState === "OPEN") {
      const remainingMs = Math.max(0, this.nextAttemptTime - Date.now());
      throw new CircuitBreakerOpenError(this.name, remainingMs);
    }

    try {
      const result = await action();
      this.recordSuccess();
      return result;
    } catch (err) {
      this.recordFailure(err);
      throw err;
    }
  }

  recordSuccess(): void {
    this.failureCount = 0;
    if (this.state === "HALF_OPEN") {
      this.transitionTo("CLOSED");
    }
  }

  recordFailure(_err?: unknown): void {
    this.failureCount += 1;
    if (this.state === "HALF_OPEN" || this.failureCount >= this.failureThreshold) {
      this.nextAttemptTime = Date.now() + this.resetTimeoutMs;
      this.transitionTo("OPEN");
    }
  }

  reset(): void {
    this.failureCount = 0;
    this.nextAttemptTime = 0;
    this.transitionTo("CLOSED");
  }

  private transitionTo(newState: CircuitBreakerState): void {
    if (this.state === newState) return;
    const oldState = this.state;
    this.state = newState;
    this.onStateChange?.(oldState, newState);
  }
}
