import { describe, expect, test } from "bun:test";
import { assertPublicUrl, BlockedUrlError, isPrivateAddress, routeIfPublic } from "../src/urlGuard";

const resolvesTo =
  (...ips: string[]) =>
  async () =>
    ips;

describe("isPrivateAddress", () => {
  test.each([
    "0.0.0.0",
    "10.1.2.3",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "198.18.0.1",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
  ])("%s is not public", (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  test.each(["93.184.216.34", "172.32.0.1", "8.8.8.8", "2606:4700::1111", "::ffff:8.8.8.8"])(
    "%s is public",
    (ip) => {
      expect(isPrivateAddress(ip)).toBe(false);
    },
  );
});

describe("assertPublicUrl", () => {
  test("accepts an http(s) URL whose host resolves only to public addresses", async () => {
    await expect(
      assertPublicUrl("https://example.com/post", resolvesTo("93.184.216.34")),
    ).resolves.toBeUndefined();
  });

  test.each([
    ["a loopback literal", "http://127.0.0.1:8080/"],
    ["an IPv6 loopback literal", "http://[::1]/"],
    ["the cloud metadata address", "http://169.254.169.254/latest/meta-data/"],
  ])("rejects %s without resolving", async (_label, url) => {
    let lookups = 0;
    const lookup = async () => {
      lookups += 1;
      return ["93.184.216.34"];
    };
    await expect(assertPublicUrl(url, lookup)).rejects.toBeInstanceOf(BlockedUrlError);
    expect(lookups).toBe(0);
  });

  test("rejects a hostname that resolves to a private address", async () => {
    await expect(
      assertPublicUrl("http://intranet.example/", resolvesTo("93.184.216.34", "10.0.0.5")),
    ).rejects.toBeInstanceOf(BlockedUrlError);
  });

  test("rejects non-http schemes", async () => {
    await expect(
      assertPublicUrl("file:///etc/passwd", resolvesTo("93.184.216.34")),
    ).rejects.toBeInstanceOf(BlockedUrlError);
  });
});

describe("routeIfPublic", () => {
  function fakeRoute(url: string) {
    const calls: string[] = [];
    return {
      calls,
      route: {
        request: () => ({ url: () => url }),
        continue: async () => {
          calls.push("continue");
        },
        abort: async (reason?: string) => {
          calls.push(`abort:${reason}`);
        },
      },
    };
  }

  test("lets a public request through", async () => {
    const { route, calls } = fakeRoute("https://example.com/app.js");
    await routeIfPublic(route, resolvesTo("93.184.216.34"));
    expect(calls).toEqual(["continue"]);
  });

  test("aborts a request to a private address", async () => {
    const { route, calls } = fakeRoute("http://192.168.1.1/admin");
    await routeIfPublic(route, resolvesTo("93.184.216.34"));
    expect(calls).toEqual(["abort:blockedbyclient"]);
  });
});
