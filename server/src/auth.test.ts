import { describe, expect, test } from "bun:test";
import { loadConfig } from "./config.ts";
import { authRole, checkAuth, matchRole } from "./auth.ts";
import { makeSessionCookie, sessionRole, SESSION_TTL_MS, shouldRefresh } from "./session.ts";

// A fixed SESSION_SECRET keeps these tests hermetic (no key-file fs) and models the
// dedicated-secret production path.
const cfg = loadConfig({
  DASHBOARD_USER: "boss",
  DASHBOARD_PASSWORD: "s3cret",
  DASHBOARD_TOKEN: "tok-abc",
  LIVE_USER: "floor",
  LIVE_PASSWORD: "live-pw",
  SESSION_SECRET: "fixed-signing-key-abc123",
});

const basic = (u: string, p: string) =>
  new Request("http://x/v1/x", {
    headers: { authorization: "Basic " + Buffer.from(`${u}:${p}`).toString("base64") },
  });
const bearer = (t: string) =>
  new Request("http://x/v1/x", { headers: { authorization: "Bearer " + t } });
const withCookie = (setCookie: string) =>
  new Request("http://x/v1/x", { headers: { cookie: setCookie.split(";")[0] } });

describe("matchRole", () => {
  test("full credentials → full", () => {
    expect(matchRole(cfg, "boss", "s3cret")).toBe("full");
  });
  test("live credentials → live", () => {
    expect(matchRole(cfg, "floor", "live-pw")).toBe("live");
  });
  test("with user+password set, token is NOT accepted as a Basic password (Bearer only)", () => {
    // credsMatch prefers the user+password branch; the token path is the alternative
    // used only when user+password are unset. Bearer-token → full is covered below.
    expect(matchRole(cfg, "anyone", "tok-abc")).toBeNull();
  });
  test("token-only config: token as Basic password → full", () => {
    const tokenOnly = loadConfig({ DASHBOARD_TOKEN: "tok-xyz" });
    expect(matchRole(tokenOnly, "anyone", "tok-xyz")).toBe("full");
  });
  test("wrong password → null", () => {
    expect(matchRole(cfg, "boss", "nope")).toBeNull();
    expect(matchRole(cfg, "floor", "nope")).toBeNull();
  });
  test("live username with full password does not cross over", () => {
    expect(matchRole(cfg, "floor", "s3cret")).toBeNull();
  });
});

describe("authRole (Authorization header)", () => {
  test("Basic full", () => expect(authRole(basic("boss", "s3cret"), cfg)).toBe("full"));
  test("Basic live", () => expect(authRole(basic("floor", "live-pw"), cfg)).toBe("live"));
  test("Basic bad → null", () => expect(authRole(basic("floor", "x"), cfg)).toBeNull());
  test("Bearer token → full", () => expect(authRole(bearer("tok-abc"), cfg)).toBe("full"));
  test("Bearer bad → null", () => expect(authRole(bearer("nope"), cfg)).toBeNull());
  test("no header → null", () =>
    expect(authRole(new Request("http://x/v1/x"), cfg)).toBeNull());
  test("checkAuth mirrors authRole presence", () => {
    expect(checkAuth(basic("boss", "s3cret"), cfg)).toBe(true);
    expect(checkAuth(basic("floor", "x"), cfg)).toBe(false);
  });
});

describe("session cookie round-trip", () => {
  const now = 1_700_000_000_000;
  test("full role survives round-trip", () => {
    const c = makeSessionCookie(cfg, now, "full");
    expect(sessionRole(withCookie(c), cfg, now + 1000)).toBe("full");
  });
  test("live role survives round-trip", () => {
    const c = makeSessionCookie(cfg, now, "live");
    expect(sessionRole(withCookie(c), cfg, now + 1000)).toBe("live");
  });
  test("expired cookie → null", () => {
    const c = makeSessionCookie(cfg, now, "full");
    expect(sessionRole(withCookie(c), cfg, now + 8 * 24 * 60 * 60 * 1000)).toBeNull();
  });
  test("tampering with the signed role is rejected", () => {
    // Take a live cookie and rewrite the role field to full — signature must fail.
    const c = makeSessionCookie(cfg, now, "live").split(";")[0];
    const val = c.slice("dash_session=".length);
    const [exp, , sig] = val.split(".");
    const forged = `dash_session=${exp}.full.${sig}`;
    expect(sessionRole(new Request("http://x", { headers: { cookie: forged } }), cfg, now + 1000)).toBeNull();
  });
  test("garbage cookie → null", () => {
    const req = new Request("http://x", { headers: { cookie: "dash_session=not.a.cookie" } });
    expect(sessionRole(req, cfg, now)).toBeNull();
  });
});

describe("sessions survive deploys / credential changes (the logout fix)", () => {
  const now = 1_700_000_000_000;
  test("a cookie stays valid after the dashboard password rotates", () => {
    const c = makeSessionCookie(cfg, now, "full");
    // Same dedicated SESSION_SECRET, but every credential field changed:
    const rotated = loadConfig({
      DASHBOARD_USER: "boss2",
      DASHBOARD_PASSWORD: "totally-new",
      DASHBOARD_TOKEN: "tok-new",
      LIVE_USER: "floor2",
      LIVE_PASSWORD: "live-new",
      SESSION_SECRET: "fixed-signing-key-abc123",
    });
    const req = new Request("http://x", { headers: { cookie: c.split(";")[0] } });
    expect(sessionRole(req, rotated, now + 1000)).toBe("full");
  });
  test("a different SESSION_SECRET DOES invalidate (secret rotation is the only reset)", () => {
    const c = makeSessionCookie(cfg, now, "full");
    const other = loadConfig({ SESSION_SECRET: "a-different-key" });
    const req = new Request("http://x", { headers: { cookie: c.split(";")[0] } });
    expect(sessionRole(req, other, now + 1000)).toBeNull();
  });
});

describe("sliding refresh", () => {
  test("fresh cookie is NOT refreshed; past half-life IS", () => {
    const now = 1_700_000_000_000;
    const exp = now + SESSION_TTL_MS;
    expect(shouldRefresh(exp, now)).toBe(false); // just issued
    expect(shouldRefresh(exp, now + SESSION_TTL_MS / 2 + 1)).toBe(true); // past half-life
  });
});
