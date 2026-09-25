import { describe, expect, test } from "vitest";
import { clsx, cn } from "./clsx";

describe("clsx", () => {
  test("joins plain strings with a space", () => {
    expect(clsx("a", "b", "c")).toBe("a b c");
  });

  test("drops falsy arguments (the &&-guard idiom)", () => {
    expect(clsx("a", false, null, undefined, "", "c")).toBe("a c");
  });

  test("maps an object to the keys whose value is truthy", () => {
    expect(clsx({ a: true, b: false, c: undefined, d: null })).toBe("a");
  });

  test("flattens nested arrays", () => {
    expect(clsx("a", ["b", ["c", false]], "d")).toBe("a b c d");
  });
});

describe("cn", () => {
  test("lets a later utility override an earlier one of the same group", () => {
    expect(cn("h-34 px-14 bg-canvas", "h-40 bg-raised")).toBe("px-14 h-40 bg-raised");
  });

  test("keeps a font size and a text colour side by side", () => {
    expect(cn("text-sm text-ink", "text-ink-muted")).toBe("text-sm text-ink-muted");
  });
});
