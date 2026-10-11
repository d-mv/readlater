import { afterEach, describe, expect, test } from "bun:test";
import { connect, createServer, type Server } from "node:net";
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
});
