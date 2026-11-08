import { afterEach, describe, expect, test, vi } from "vitest";
import { copyText } from "./clipboard";

describe("copyText", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test("writes through the async clipboard API", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await copyText("hello");
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  test("falls back to a hidden textarea + execCommand when the API refuses", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    let copied: string | null = null;
    const execCommand = vi.fn(() => {
      copied = document.querySelector("textarea")?.value ?? null;
      return true;
    });
    Object.defineProperty(document, "execCommand", { value: execCommand, configurable: true });

    await copyText("fallback");
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(copied).toBe("fallback");
    expect(document.querySelector("textarea")).toBeNull();
  });
});
