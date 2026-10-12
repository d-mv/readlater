import { afterEach, describe, expect, test } from "bun:test";
import { connect, createServer, Socket, type Server } from "node:net";
import { startEgressProxy, type EgressProxy } from "../src/egressProxy";

let proxy: EgressProxy | null = null;
let upstream: Server | null = null;

afterEach(async () => {
  await proxy?.close();
  proxy = null;
  await new Promise<void>((resolve) => (upstream ? upstream.close(() => resolve()) : resolve()));
  upstream = null;
});

/** Sends raw bytes to the proxy and collects everything it answers until close. */
function send(proxyUrl: string, payload: string): Promise<string> {
  const { port } = new URL(proxyUrl);
  return new Promise((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port: Number(port) });
    let received = "";
    socket.on("data", (chunk) => {
      received += chunk.toString();
    });
    socket.on("close", () => resolve(received));
    socket.on("error", reject);
    socket.write(payload);
  });
}

/** A local upstream that answers every request with the request it saw. */
async function startEchoUpstream(): Promise<number> {
  upstream = createServer((socket) => {
    socket.once("data", (chunk) => {
      const body = chunk.toString();
      socket.end(`HTTP/1.1 200 OK\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
    });
  });
  await new Promise<void>((resolve) => upstream!.listen(0, "127.0.0.1", () => resolve()));
  const address = upstream.address();
  return typeof address === "object" && address ? address.port : 0;
}

describe("egress proxy", () => {
  test("refuses a CONNECT to a private IP literal", async () => {
    proxy = await startEgressProxy({ lookup: async () => ["93.184.216.34"] });
    const answer = await send(proxy.url, "CONNECT 127.0.0.1:443 HTTP/1.1\r\n\r\n");
    expect(answer).toStartWith("HTTP/1.1 403");
  });

  test("refuses a CONNECT to a hostname that resolves to a private address", async () => {
    proxy = await startEgressProxy({ lookup: async () => ["93.184.216.34", "10.0.0.7"] });
    const answer = await send(proxy.url, "CONNECT rebind.example:443 HTTP/1.1\r\n\r\n");
    expect(answer).toStartWith("HTTP/1.1 403");
  });

  test("refuses a plain-http request to the metadata address", async () => {
    proxy = await startEgressProxy();
    const answer = await send(
      proxy.url,
      "GET http://169.254.169.254/latest/meta-data/ HTTP/1.1\r\nHost: 169.254.169.254\r\n\r\n",
    );
    expect(answer).toStartWith("HTTP/1.1 403");
  });

  test("resolves once and connects to exactly the vetted address", async () => {
    const port = await startEchoUpstream();
    let lookups = 0;
    // The "public" answer is the local echo server; isPrivate is relaxed so
    // the test can reach it. A second lookup would return a different address.
    proxy = await startEgressProxy({
      lookup: async () => {
        lookups += 1;
        return lookups === 1 ? ["127.0.0.1"] : ["192.0.2.1"];
      },
      isPrivate: () => false,
    });

    const answer = await send(
      proxy.url,
      `GET http://site.example:${port}/a?b=1 HTTP/1.1\r\nHost: site.example\r\nProxy-Connection: keep-alive\r\n\r\n`,
    );

    expect(lookups).toBe(1);
    expect(answer).toStartWith("HTTP/1.1 200 OK");
    // Forwarded in origin form, proxy headers stripped, one request per connection.
    expect(answer).toContain("GET /a?b=1 HTTP/1.1\r\n");
    expect(answer).toContain("Host: site.example\r\n");
    expect(answer).toContain("Connection: close\r\n");
    expect(answer).not.toContain("Proxy-Connection");
  });

  test("tunnels a CONNECT to a vetted address", async () => {
    const port = await startEchoUpstream();
    proxy = await startEgressProxy({ lookup: async () => ["127.0.0.1"], isPrivate: () => false });

    const answer = await send(proxy.url, `CONNECT site.example:${port} HTTP/1.1\r\n\r\nPING`);

    expect(answer).toStartWith("HTTP/1.1 200 Connection Established\r\n\r\n");
    expect(answer).toEndWith("PING");
  });

  test("rejects a non-http absolute URL", async () => {
    proxy = await startEgressProxy({ lookup: async () => ["93.184.216.34"] });
    const answer = await send(proxy.url, "GET ftp://example.com/ HTTP/1.1\r\n\r\n");
    expect(answer).toStartWith("HTTP/1.1 400");
  });

  test("refuses a host that doesn't resolve", async () => {
    proxy = await startEgressProxy({
      lookup: async () => {
        throw Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
      },
    });
    const answer = await send(proxy.url, "CONNECT nowhere.example:443 HTTP/1.1\r\n\r\n");
    expect(answer).toStartWith("HTTP/1.1 403");
  });

  test("rejects a request target that isn't an absolute URL", async () => {
    proxy = await startEgressProxy({ lookup: async () => ["93.184.216.34"] });
    const answer = await send(proxy.url, "GET /relative HTTP/1.1\r\nHost: x\r\n\r\n");
    expect(answer).toStartWith("HTTP/1.1 400");
  });

  test.each(["example.com", "example.com:0", "example.com:70000"])(
    "rejects a CONNECT to %p, which isn't a valid host:port",
    async (authority) => {
      proxy = await startEgressProxy({ lookup: async () => ["93.184.216.34"] });
      const answer = await send(proxy.url, `CONNECT ${authority} HTTP/1.1\r\n\r\n`);
      expect(answer).toStartWith("HTTP/1.1 400");
    },
  );

  test("refuses request headers that never end instead of buffering them forever", async () => {
    proxy = await startEgressProxy({ lookup: async () => ["93.184.216.34"] });
    const answer = await send(
      proxy.url,
      `GET http://example.com/ HTTP/1.1\r\nX-Filler: ${"a".repeat(33 * 1024)}`,
    );
    expect(answer).toStartWith("HTTP/1.1 431");
  });

  test("answers 502 when the vetted upstream refuses the connection", async () => {
    const port = await startEchoUpstream();
    await new Promise<void>((resolve) => upstream!.close(() => resolve()));
    upstream = null;
    proxy = await startEgressProxy({ lookup: async () => ["127.0.0.1"], isPrivate: () => false });

    const answer = await send(proxy.url, `CONNECT site.example:${port} HTTP/1.1\r\n\r\n`);

    expect(answer).toStartWith("HTTP/1.1 502");
  });

  test("gives up on an upstream that doesn't connect within the connect timeout", async () => {
    let upstreamSocket: Socket | null = null;
    proxy = await startEgressProxy({
      lookup: async () => ["93.184.216.34"],
      // A socket that never connects, like a SYN to a black-holed address.
      connectUpstream: () => {
        upstreamSocket = new Socket();
        return upstreamSocket;
      },
      connectTimeoutMs: 100,
    });

    const startedAt = Date.now();
    const answer = await send(proxy.url, "CONNECT slow.example:443 HTTP/1.1\r\n\r\n");

    expect(answer).toStartWith("HTTP/1.1 502");
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(90);
    expect(upstreamSocket!.destroyed).toBe(true);
  });

  test("close() during a pending upstream connect leaves no upstream connection behind", async () => {
    const upstreamSeen: string[] = [];
    let upstreamClosed!: () => void;
    const closed = new Promise<void>((resolve) => (upstreamClosed = resolve));
    upstream = createServer((socket) => {
      socket.on("data", (chunk) => upstreamSeen.push(chunk.toString()));
      socket.on("close", () => upstreamClosed());
    });
    await new Promise<void>((resolve) => upstream!.listen(0, "127.0.0.1", () => resolve()));
    const port = (upstream.address() as { port: number }).port;

    let resolveLookup!: (ips: string[]) => void;
    let lookupStarted!: () => void;
    const started = new Promise<void>((resolve) => (lookupStarted = resolve));
    proxy = await startEgressProxy({
      lookup: () => {
        lookupStarted();
        return new Promise((resolve) => (resolveLookup = resolve));
      },
      isPrivate: () => false,
    });

    const answer = send(proxy.url, `CONNECT site.example:${port} HTTP/1.1\r\n\r\nPING`);
    await started;
    await proxy.close();
    proxy = null;
    resolveLookup(["127.0.0.1"]);

    expect(await answer).toBe("");
    await closed;
    expect(upstreamSeen).toEqual([]);
  });

  test("closes the client connection if vetting the destination fails unexpectedly", async () => {
    proxy = await startEgressProxy({
      lookup: async () => ["93.184.216.34"],
      isPrivate: () => {
        throw new Error("boom");
      },
    });
    const answer = await send(proxy.url, "CONNECT site.example:443 HTTP/1.1\r\n\r\n");
    expect(answer).toBe("");
  });

  test("close() tears down open tunnels", async () => {
    upstream = createServer(() => {});
    await new Promise<void>((resolve) => upstream!.listen(0, "127.0.0.1", () => resolve()));
    const port = (upstream.address() as { port: number }).port;
    proxy = await startEgressProxy({ lookup: async () => ["127.0.0.1"], isPrivate: () => false });

    let established!: () => void;
    const tunnelOpen = new Promise<void>((resolve) => (established = resolve));
    const client = connect({ host: "127.0.0.1", port: Number(new URL(proxy.url).port) });
    const clientClosed = new Promise<void>((resolve) => client.on("close", () => resolve()));
    client.on("data", (chunk) => {
      if (chunk.toString().includes("200 Connection Established")) established();
    });
    client.write(`CONNECT site.example:${port} HTTP/1.1\r\n\r\n`);
    await tunnelOpen;

    await proxy.close();
    proxy = null;

    await clientClosed;
    expect(client.destroyed).toBe(true);
  });
});
