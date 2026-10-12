import { afterEach, describe, expect, test } from "vitest";
import { cspNonce } from "./cspNonce";

function setMeta(content: string) {
  const meta = document.createElement("meta");
  meta.name = "csp-nonce";
  meta.content = content;
  document.head.append(meta);
}

describe("cspNonce", () => {
  afterEach(() => {
    document.head.querySelectorAll('meta[name="csp-nonce"]').forEach((m) => m.remove());
  });

  test("reads the nonce nginx substituted into the meta tag", () => {
    setMeta("3f2a9c0d1e4b5a6978c0d1e2f3a4b5c6");
    expect(cspNonce()).toBe("3f2a9c0d1e4b5a6978c0d1e2f3a4b5c6");
  });

  test("is null while the placeholder is unreplaced (dev server, no CSP)", () => {
    setMeta("__CSP_NONCE__");
    expect(cspNonce()).toBeNull();
  });

  test("is null without the meta tag or with an empty one", () => {
    expect(cspNonce()).toBeNull();
    setMeta("");
    expect(cspNonce()).toBeNull();
  });
});
