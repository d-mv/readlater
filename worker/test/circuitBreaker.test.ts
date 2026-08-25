import { describe, expect, test } from "bun:test";
import { CircuitBreaker, CircuitBreakerOpenError } from "../src/circuitBreaker";

describe("CircuitBreaker", () => {
  test("starts in CLOSED state and executes actions normally", async () => {
    const breaker = new CircuitBreaker({ name: "test-breaker" });
    expect(breaker.getState()).toBe("CLOSED");

    const result = await breaker.execute(async () => "hello");
    expect(result).toBe("hello");
    expect(breaker.getState()).toBe("CLOSED");
  });

  test("trips to OPEN after consecutive failures reach failureThreshold", async () => {
    let stateChanges: string[] = [];
    const breaker = new CircuitBreaker({
      name: "test-breaker",
      failureThreshold: 3,
      resetTimeoutMs: 1000,
      onStateChange: (from, to) => stateChanges.push(`${from}->${to}`),
    });

    const failingAction = async () => {
      throw new Error("service down");
    };

    // 1st failure
    await expect(breaker.execute(failingAction)).rejects.toThrow("service down");
    expect(breaker.getState()).toBe("CLOSED");

    // 2nd failure
    await expect(breaker.execute(failingAction)).rejects.toThrow("service down");
    expect(breaker.getState()).toBe("CLOSED");

    // 3rd failure - trips breaker
    await expect(breaker.execute(failingAction)).rejects.toThrow("service down");
    expect(breaker.getState()).toBe("OPEN");
    expect(stateChanges).toEqual(["CLOSED->OPEN"]);

    // 4th attempt: fails fast with CircuitBreakerOpenError without executing action
    let actionCalled = false;
    await expect(
      breaker.execute(async () => {
        actionCalled = true;
        return "ok";
      }),
    ).rejects.toBeInstanceOf(CircuitBreakerOpenError);
    expect(actionCalled).toBe(false);
  });

  test("resets failure count on success while CLOSED", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3 });

    // 2 failures
    await expect(
      breaker.execute(async () => {
        throw new Error("fail");
      }),
    ).rejects.toThrow();
    await expect(
      breaker.execute(async () => {
        throw new Error("fail");
      }),
    ).rejects.toThrow();

    // 1 success resets counter
    await breaker.execute(async () => "ok");

    // 2 more failures should not trip breaker because count was reset
    await expect(
      breaker.execute(async () => {
        throw new Error("fail");
      }),
    ).rejects.toThrow();
    await expect(
      breaker.execute(async () => {
        throw new Error("fail");
      }),
    ).rejects.toThrow();
    expect(breaker.getState()).toBe("CLOSED");
  });

  test("transitions to HALF_OPEN after resetTimeoutMs and closes on successful trial", async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 2,
      resetTimeoutMs: 50,
    });

    await expect(
      breaker.execute(async () => {
        throw new Error("fail");
      }),
    ).rejects.toThrow();
    await expect(
      breaker.execute(async () => {
        throw new Error("fail");
      }),
    ).rejects.toThrow();
    expect(breaker.getState()).toBe("OPEN");

    // Wait for timeout to elapse
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(breaker.getState()).toBe("HALF_OPEN");

    // Trial execution succeeds
    const res = await breaker.execute(async () => "recovered");
    expect(res).toBe("recovered");
    expect(breaker.getState()).toBe("CLOSED");
  });

  test("transitions from HALF_OPEN back to OPEN if trial execution fails", async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 2,
      resetTimeoutMs: 50,
    });

    await expect(
      breaker.execute(async () => {
        throw new Error("fail");
      }),
    ).rejects.toThrow();
    await expect(
      breaker.execute(async () => {
        throw new Error("fail");
      }),
    ).rejects.toThrow();
    expect(breaker.getState()).toBe("OPEN");

    // Wait for timeout to elapse
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(breaker.getState()).toBe("HALF_OPEN");

    // Trial execution fails
    await expect(
      breaker.execute(async () => {
        throw new Error("still broken");
      }),
    ).rejects.toThrow("still broken");
    expect(breaker.getState()).toBe("OPEN");
  });

  test("manual reset sets state back to CLOSED", () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1 });
    breaker.recordFailure();
    expect(breaker.getState()).toBe("OPEN");

    breaker.reset();
    expect(breaker.getState()).toBe("CLOSED");
  });
});
