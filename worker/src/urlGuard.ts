import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

// The worker fetches (and renders in Chromium) arbitrary user-submitted URLs.
// Without a guard, a bookmark pointing at the VPS itself, the Docker network,
// the router, or a cloud metadata endpoint would have the worker request it
// and store the response as an "article". Only http(s) URLs whose host
// resolves exclusively to public addresses are allowed.
//
// Known gap: the address is checked at resolve time and fetch() resolves
// again (DNS rebinding). Acceptable for a single-user app; closing it would
// need pinning the connection to the checked address.

export class BlockedUrlError extends Error {
  override name = "BlockedUrlError";
}

/** Resolves a hostname to every address it maps to. */
export type LookupAll = (hostname: string) => Promise<string[]>;

export const lookupAll: LookupAll = async (hostname) =>
  (await dnsLookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);

// [network, prefix length] — loopback, private, CGNAT, link-local (incl. the
// 169.254.169.254 metadata service), documentation/benchmark, multicast and
// reserved ranges.
const PRIVATE_V4: readonly [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function isPrivateV4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  return PRIVATE_V4.some(([network, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (value & mask) === (ipv4ToInt(network) & mask);
  });
}

/** Expands an IPv6 address to its eight 16-bit groups. */
function ipv6Groups(ip: string): number[] {
  let address = ip;
  // A trailing dotted IPv4 part (::ffff:1.2.3.4) becomes two hex groups.
  const v4 = address.match(/(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (v4) {
    const n = ipv4ToInt(v4);
    address =
      address.slice(0, -v4.length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const [head = "", tail] = address.split("::");
  const headGroups = head ? head.split(":") : [];
  const tailGroups = tail ? tail.split(":") : [];
  const missing = 8 - headGroups.length - tailGroups.length;
  const groups =
    tail === undefined ? headGroups : [...headGroups, ...Array(missing).fill("0"), ...tailGroups];
  return groups.map((group) => parseInt(group, 16) || 0);
}

function isPrivateV6(ip: string): boolean {
  const g = ipv6Groups(ip);
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = g;
  const embeddedV4 = `${g6 >>> 8}.${g6 & 0xff}.${g7 >>> 8}.${g7 & 0xff}`;

  if (g.every((group) => group === 0)) return true; // ::
  if (g.slice(0, 7).every((group) => group === 0) && g7 === 1) return true; // ::1
  // IPv4-mapped (::ffff:a.b.c.d) and NAT64 (64:ff9b::a.b.c.d) carry an IPv4 address.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) {
    return isPrivateV4(embeddedV4);
  }
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    return isPrivateV4(embeddedV4);
  }
  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g0 & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (g0 === 0x2001 && g1 === 0x0db8) return true; // 2001:db8::/32 documentation
  if (g0 === 0x0100 && g1 === 0 && g2 === 0 && g3 === 0) return true; // 100::/64 discard
  return false;
}

/** True for any address that isn't a routable public unicast address. */
export function isPrivateAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isPrivateV4(ip);
  if (version === 6) return isPrivateV6(ip);
  return true; // not an IP at all — never treat as public
}

export async function assertPublicUrl(url: string, lookup: LookupAll = lookupAll): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new BlockedUrlError(`Not a valid URL: ${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new BlockedUrlError(`Only http(s) URLs can be fetched: ${url}`);
  }

  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : await lookup(host);
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new BlockedUrlError(`Refusing to fetch ${url}: it resolves to a non-public address`);
  }
}

/** The subset of a Playwright Route the guard needs. */
export interface GuardedRoute {
  request(): { url(): string };
  continue(): Promise<void>;
  abort(errorCode?: string): Promise<void>;
}

// Playwright route handler: lets the headless browser load a page and its
// subresources only from public addresses, so the render fallback can't be
// steered at internal hosts either (e.g. via a redirect or an <img src>).
export async function routeIfPublic(route: GuardedRoute, lookup: LookupAll = lookupAll) {
  try {
    await assertPublicUrl(route.request().url(), lookup);
  } catch {
    await route.abort("blockedbyclient");
    return;
  }
  await route.continue();
}
