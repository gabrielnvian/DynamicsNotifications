import { expect, test } from "bun:test";
import {
  clientIpAllowed,
  getClientIp,
  isValidCidr,
  makeCidrGate,
  parseCidr,
} from "./cidr.ts";

test("parseCidr", () => {
  expect(parseCidr("10.0.0.0/8")).toEqual({ net: "10.0.0.0", prefix: 8, type: "ipv4" });
  expect(parseCidr("2001:db8::/32")?.type).toBe("ipv6");
  expect(parseCidr("100.64.0.0/10")?.type).toBe("ipv4");
  expect(parseCidr("nope")).toBeNull();
  expect(parseCidr("10.0.0.0/40")).toBeNull();
  expect(isValidCidr("203.0.113.0/24")).toBe(true);
});

test("clientIpAllowed semantics (empty=allow, all-malformed=deny, match)", () => {
  expect(clientIpAllowed("1.2.3.4", [])).toBe(true);
  expect(clientIpAllowed("1.2.3.4", null)).toBe(true);
  expect(clientIpAllowed("1.2.3.4", ["garbage"])).toBe(false);
  expect(clientIpAllowed("10.1.2.3", ["10.0.0.0/8"])).toBe(true);
  expect(clientIpAllowed("11.1.2.3", ["10.0.0.0/8"])).toBe(false);
  // IPv4-mapped IPv6 normalizes to IPv4 and matches an IPv4 subnet
  expect(clientIpAllowed("::ffff:10.1.2.3", ["10.0.0.0/8"])).toBe(true);
  // IPv6 match
  expect(clientIpAllowed("2001:db8::5", ["2001:db8::/32"])).toBe(true);
});

test("makeCidrGate fail-closed when enforcing with no valid CIDR", () => {
  expect(makeCidrGate([], true).allowed("10.0.0.1")).toBe(false);
  expect(makeCidrGate(["garbage"], true).allowed("10.0.0.1")).toBe(false);
  expect(makeCidrGate([], false).allowed("10.0.0.1")).toBe(true); // gate off (dev)
  const g = makeCidrGate(["203.0.113.0/24"], true);
  expect(g.allowed("203.0.113.7")).toBe(true);
  expect(g.allowed("203.0.114.7")).toBe(false);
  expect(g.allowed("not-an-ip")).toBe(false);
});

test("getClientIp reads leftmost XFF (funnel replaces => single trusted value)", () => {
  const spoofed = new Request("http://x/", {
    headers: { "x-forwarded-for": "9.9.9.9, 1.2.3.4" },
  });
  expect(getClientIp(spoofed, "127.0.0.1")).toBe("9.9.9.9");
  const none = new Request("http://x/");
  expect(getClientIp(none, "127.0.0.1")).toBe("127.0.0.1");
});
