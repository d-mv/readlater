import { describe, expect, test } from "vitest";
import { KEY_ACTIVATION_GRACE_MS, isDeliberateActivation } from "./deliberateActivation";

describe("isDeliberateActivation", () => {
  const click = (detail: number) => new MouseEvent("click", { detail });

  test("a pointer click counts at once", () => {
    expect(isDeliberateActivation(click(1), 1000, 1000)).toBe(true);
  });

  test("a keypress right after the prompt appeared doesn't count", () => {
    expect(isDeliberateActivation(click(0), 1000, 1000 + KEY_ACTIVATION_GRACE_MS - 1)).toBe(false);
  });

  test("a keypress once the prompt has been on screen a moment counts", () => {
    expect(isDeliberateActivation(click(0), 1000, 1000 + KEY_ACTIVATION_GRACE_MS)).toBe(true);
  });
});
