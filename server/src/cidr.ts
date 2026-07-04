// Client-IP (CIDR) gating for the metrics server.
//
// Trust model (from the Hub's proven deployment, cohub msg #1946/#1958):
// Tailscale Funnel terminates TLS locally and forwards to this server injecting
// `X-Forwarded-For`, REPLACING any client-sent value with the IP it observed.
// So the header carries exactly ONE value = the real client, and we read the
// LEFTMOST entry. This is safe ONLY because (1) the funnel replaces XFF (does
// not append) and (2) the server binds to loopback / the port is firewalled to
// the funnel, so nothing can connect directly and forge XFF.
//
// ⚠️ If you ever chain another proxy in front (nginx/Cloudflare) that APPENDS to
// XFF, `[0]` becomes the client's injected (spoofable) value — you must then
// switch to counting from the RIGHT by trusted-proxy depth and re-run the
// spoof-test in deploy/TAILSCALE.md.

import { BlockList, isIPv4, isIPv6 } from "node:net";

/** Parse a `network/prefix` string. Returns null for invalid input. */
export function parseCidr(
  cidr: string,
): { net: string; prefix: number; type: "ipv4" | "ipv6" } | null {
  const m = cidr.trim().match(/^([^/]+)\/(\d+)$/);
  if (!m) return null;
  const net = m[1];
  const prefix = Number(m[2]);
  if (!Number.isInteger(prefix) || prefix < 0) return null;
  if (isIPv4(net) && prefix <= 32) return { net, prefix, type: "ipv4" };
  if (isIPv6(net) && prefix <= 128) return { net, prefix, type: "ipv6" };
  return null;
}

export function isValidCidr(cidr: string): boolean {
  return parseCidr(cidr) !== null;
}

/** Normalize IPv4-mapped IPv6 (`::ffff:1.2.3.4`) back to `1.2.3.4` so IPv4
 *  subnets match clients arriving over a dual-stack listener. */
function normalizeIp(ip: string): string {
  return ip.startsWith("::ffff:") ? ip.slice(7) : ip;
}

function buildBlockList(cidrs: readonly string[]): { bl: BlockList; count: number } {
  const bl = new BlockList();
  let count = 0;
  for (const c of cidrs) {
    const p = parseCidr(c);
    if (!p) continue;
    try {
      bl.addSubnet(p.net, p.prefix, p.type);
      count++;
    } catch {
      /* skip malformed */
    }
  }
  return { bl, count };
}

/**
 * Standalone check (matches the Hub's `clientIpAllowed` semantics):
 * - empty/null list → allow (no restriction configured)
 * - list set but every entry malformed → deny (fail closed on misconfig)
 * - otherwise → allow iff `clientIp` matches at least one CIDR
 */
export function clientIpAllowed(
  clientIp: string,
  cidrs: readonly string[] | null,
): boolean {
  if (!cidrs || cidrs.length === 0) return true;
  const { bl, count } = buildBlockList(cidrs);
  if (count === 0) return false;
  const ip = normalizeIp(clientIp);
  const type = isIPv4(ip) ? "ipv4" : isIPv6(ip) ? "ipv6" : null;
  if (!type) return false;
  return bl.check(ip, type);
}

/** Pre-compiled gate for the request hot path. When `enforce` is true an empty
 *  or all-invalid allowlist FAILS CLOSED (denies everything) — a misconfig can
 *  never accidentally open the server to the internet. */
export interface CidrGate {
  enforce: boolean;
  count: number;
  allowed(ip: string): boolean;
}

export function makeCidrGate(cidrs: string[], enforce: boolean): CidrGate {
  const { bl, count } = buildBlockList(cidrs);
  return {
    enforce,
    count,
    allowed(ip: string): boolean {
      if (!enforce) return true; // gate disabled (dev only)
      if (count === 0) return false; // enforcing but nothing valid → fail closed
      const norm = normalizeIp(ip);
      const type = isIPv4(norm) ? "ipv4" : isIPv6(norm) ? "ipv6" : null;
      if (!type) return false;
      return bl.check(norm, type);
    },
  };
}

/**
 * Derive the client IP on Bun.serve. `socketRemoteAddr` is the raw TCP peer
 * (`server.requestIP(req)?.address`). With Tailscale Funnel replacing XFF, the
 * header holds one value = the real client → take the leftmost. Absent a header
 * (e.g. a local probe) we fall back to the socket peer, which — with the port
 * firewalled to the funnel — is the funnel itself.
 */
export function getClientIp(req: Request, socketRemoteAddr: string): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0].trim();
    if (first) return first;
  }
  return socketRemoteAddr || "";
}
