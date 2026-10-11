import { createServer, connect, isIP, type Socket } from "node:net";
import { isPrivateAddress, lookupAll, type LookupAll } from "./urlGuard";

// Local forward proxy that every byte the headless browser sends to the
// network goes through (Chromium is launched with --proxy-server pointing
// here; Playwright also adds <-loopback> so even localhost isn't bypassed).
//
// Why a proxy and not just context.route(): page JavaScript runs in Chromium,
// and Chromium resolves hostnames itself, so a route handler that checks a
// URL by its own DNS lookup can be beaten by DNS rebinding (public answer to
// the check, private answer to Chromium a moment later). Here the proxy is
// the one that resolves the host: it checks every address once, refuses the
// request if any is private, and then connects to exactly the address it
// checked. Chromium never resolves page hosts at all while a proxy is set.
// CONNECT tunnels (https, wss) and plain-http requests are both covered.

export interface EgressProxy {
  /** e.g. "http://127.0.0.1:41234" */
  readonly url: string;
  close(): Promise<void>;
}

const MAX_HEADER_BYTES = 32 * 1024;
const UPSTREAM_CONNECT_TIMEOUT_MS = 10_000;
// Hop-by-hop headers dropped from a forwarded plain-http request.
const HOP_BY_HOP = new Set(["proxy-connection", "proxy-authorization", "connection", "keep-alive"]);

interface Target {
  host: string;
  port: number;
}

function parseAuthority(authority: string): Target | null {
  const match = authority.match(/^\[?([^\]]+?)\]?:(\d{1,5})$/);
  if (!match?.[1] || !match[2]) return null;
  const port = Number(match[2]);
  if (port < 1 || port > 65535) return null;
  return { host: match[1], port };
}

function reply(socket: Socket, status: string) {
  socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

export async function startEgressProxy(
  deps: { lookup?: LookupAll; isPrivate?: (ip: string) => boolean } = {},
): Promise<EgressProxy> {
  const lookup = deps.lookup ?? lookupAll;
  const isPrivate = deps.isPrivate ?? isPrivateAddress;
  const sockets = new Set<Socket>();

  /** Resolves once and returns the address to connect to, or null if refused. */
  async function vettedAddress(host: string): Promise<string | null> {
    const addresses = isIP(host) ? [host] : await lookup(host).catch(() => []);
    if (addresses.length === 0 || addresses.some(isPrivate)) return null;
    return addresses[0] ?? null;
  }

  function track(socket: Socket) {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
  }

  function openUpstream(address: string, port: number): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const upstream = connect({ host: address, port });
      track(upstream);
      const timer = setTimeout(() => {
        upstream.destroy();
        reject(new Error("upstream connect timed out"));
      }, UPSTREAM_CONNECT_TIMEOUT_MS);
      upstream.once("connect", () => {
        clearTimeout(timer);
        resolve(upstream);
      });
      upstream.once("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  async function handle(client: Socket, head: Buffer, rest: Buffer) {
    const lines = head.toString("latin1").split("\r\n");
    const [method = "", target = "", version = "HTTP/1.1"] = (lines[0] ?? "").split(" ");

    let dest: Target | null;
    let requestHead: string | null = null;
    if (method === "CONNECT") {
      dest = parseAuthority(target);
    } else {
      let url: URL;
      try {
        url = new URL(target);
      } catch {
        return reply(client, "400 Bad Request");
      }
      if (url.protocol !== "http:") return reply(client, "400 Bad Request");
      dest = { host: url.hostname.replace(/^\[|\]$/g, ""), port: Number(url.port || 80) };
      // Origin-form request line, hop-by-hop headers stripped, and one
      // request per connection: with Connection: close the browser can't
      // reuse this socket for a request to a different host.
      const headers = lines
        .slice(1)
        .filter((line) => line && !HOP_BY_HOP.has(line.split(":")[0]!.trim().toLowerCase()));
      requestHead = [
        `${method} ${url.pathname}${url.search} ${version}`,
        ...headers,
        "Connection: close",
        "",
        "",
      ].join("\r\n");
    }
    if (!dest) return reply(client, "400 Bad Request");

    const address = await vettedAddress(dest.host);
    if (!address) return reply(client, "403 Forbidden");

    let upstream: Socket;
    try {
      upstream = await openUpstream(address, dest.port);
    } catch {
      return reply(client, "502 Bad Gateway");
    }
    if (client.destroyed) return upstream.destroy();

    if (requestHead === null) client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    else upstream.write(requestHead);
    if (rest.length > 0) upstream.write(rest);
    client.pipe(upstream);
    upstream.pipe(client);
    client.on("close", () => upstream.destroy());
    upstream.on("close", () => client.destroy());
  }

  const server = createServer((client) => {
    track(client);
    let buffered = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      const end = buffered.indexOf("\r\n\r\n");
      if (end === -1) {
        if (buffered.length > MAX_HEADER_BYTES) {
          client.off("data", onData);
          reply(client, "431 Request Header Fields Too Large");
        }
        return;
      }
      client.off("data", onData);
      client.pause();
      handle(client, buffered.subarray(0, end), buffered.subarray(end + 4)).catch(() =>
        client.destroy(),
      );
    };
    client.on("data", onData);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
