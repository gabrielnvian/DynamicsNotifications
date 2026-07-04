# Exposing the metrics server on Tailscale Funnel + the CIDR spoof-test

The server binds to `127.0.0.1:$PORT` (default 3000). Tailscale sits in front and
is the **only** path in. This is what makes the `X-Forwarded-For`-based CIDR gate
safe (see `src/cidr.ts`).

## Put Funnel in front (public HTTPS)

```sh
tailscale funnel --bg --https=443 http://127.0.0.1:3000
tailscale funnel status        # shows the public https://<node>.<tailnet>.ts.net
```
(Funnel is limited to ports 443 / 8443 / 10000.) For tailnet-only access instead,
use `tailscale serve` — it also injects the real source IP and needs no PROXY
protocol.

## Why the CIDR gate is sound here

1. Funnel terminates TLS and forwards to `127.0.0.1`, injecting `X-Forwarded-For`
   and **replacing** any value the client sent. So the header holds one value =
   the real client IP; the server reads the **leftmost** entry.
2. Nothing but tailscaled can reach `:3000` (loopback bind / firewalled). So an
   attacker cannot connect directly and forge `X-Forwarded-For`.

Break either precondition and the gate is spoofable. **Verify with the test
below before relying on it.** (If you later chain another proxy that *appends* to
XFF, switch `getClientIp` to count from the right — see the note in `cidr.ts`.)

## Spoof-test (run once per deployment)

Temporarily set in `.env` and restart:

```sh
ALLOWED_CIDRS=9.9.9.9/32
CIDR_ENFORCE=true
```

The ingest route is CIDR-only, so it isolates the gate cleanly:

```sh
# (1) Through the funnel WITH a spoofed header — MUST be denied.
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  -H "X-Forwarded-For: 9.9.9.9" -H "content-type: application/json" -d '{}' \
  https://<node>.<tailnet>.ts.net/v1/events
# Expect: 403   (funnel replaced your header with the real client IP, which is
#                not in 9.9.9.9/32)

# (2) Directly to the app port WITH a spoofed header — will be ALLOWED past CIDR.
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  -H "X-Forwarded-For: 9.9.9.9" -H "content-type: application/json" -d '{}' \
  http://127.0.0.1:3000/v1/events
# Expect: 400   (CIDR allowed 9.9.9.9, then the empty body was rejected).
#         This is why the port MUST be unreachable from outside.
```

If (1) ever returns anything but 403, your upstream is **appending** rather than
replacing XFF — stop trusting the header (see `docs/METRICS-PLAN.md`).

Then set `ALLOWED_CIDRS` to the operators' real egress CIDR(s) and restart.
