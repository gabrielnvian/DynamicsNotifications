# Chrome Web Store — Data Disclosure Report

Prepared for the Chrome Web Store "Privacy practices" submission for the
**Dynamics Notifications** extension. The extension is **unlisted** and distributed
by the operator's employer to company devices for internal use only; it is not
offered to the public. This documents exactly what data it gathers, what is
transmitted, and where.

> The Team Metrics feature is **always on** for this internal build: call-handling
> metrics are recorded per employer policy as a condition of use on company
> systems. There is no end-user opt-out. Operators are informed via an in-extension
> notice and the shipped `PRIVACY-POLICY.md`.

---

## 1. Single purpose

The extension alerts Dynamics 365 Omnichannel operators to incoming calls, and
reports aggregate call-handling statistics and a live availability status to a
self-hosted server the operator's organisation controls.

## 2. Data collected and transmitted

The extension transmits **only** the following to the organisation's self-hosted
metrics server. This is the complete list.

### Personal / identifying data
| Item | What it is | Why | CWS data type |
|---|---|---|---|
| **Operator first name** | First name only (first token; digits/symbols rejected; max 40 chars), detected from the signed-in Microsoft 365 account. | To label which operator the metrics belong to. | **Personally identifiable information → Name** |
| **Anonymous install ID** | A random UUID generated on the device (`crypto.randomUUID()`), stored in `chrome.storage.sync`. Not derived from any hardware/user identifier and never joined to an IP address server-side. | To distinguish two operators who share a first name and de-duplicate re-sent data. | Not personally identifying (pseudonymous device tag) — disclosed for transparency. |

### Non-personal metric data
Per calendar day (operator-local), as plain numbers:
| Item | What it is |
|---|---|
| Available seconds | Time the operator was present and eligible to take calls. |
| Calls received (count) | Number of incoming calls presented. |
| Calls answered (count) | Number of calls picked up. |
| Time-to-answer (ms) | Ring-to-pickup duration, per answered call. |
| Handle time (ms) | Pickup-to-hang-up (talk) duration, per answered call where measurable; after-call wrap-up is not included (since v1.9). |

### Current status (live presence board)
| Item | What it is |
|---|---|
| Status heartbeat | A periodic value — `available`, `on_call`, or `away` — sent while a Dynamics tab is open, so a team lead can see current availability. `offline` is derived server-side from missed heartbeats and is never sent. No caller data is included. |

### Technical envelope
Extension version, schema version, a batch UUID, timestamps, and per-event
idempotency UUIDs.

## 3. Data explicitly NOT collected

Payloads are assembled field-by-field from a fixed constant on the device and
validated again server-side, which rejects any unknown field. The following are
**never** collected or transmitted:

- Caller names, caller phone numbers, or any caller/contact details.
- Call content, audio, recordings, or transcripts (no audio is ever recorded;
  microphone access is used only to enumerate output device names — see §5).
- The operator's full name, email, username, Dynamics agent ID, or any Dynamics
  account identifier.
- Message content, page content, URLs, tab titles, or browsing history.
- IP address, geolocation, device fingerprint, or user-agent (the server does not
  store request IPs alongside metrics).

## 4. Data handling

- **Transmission:** HTTPS only, to a single organisation-controlled endpoint (a
  self-hosted server on a Tailscale Funnel address). The metrics/status ingest
  endpoints are restricted to the organisation's network by a **CIDR allowlist**
  (matched on the leftmost `X-Forwarded-For`, fail-closed); the server binds to
  loopback behind the tunnel. The reporting dashboard and its read/CSV endpoints
  require **HTTP Basic authentication**.
- **No third parties, no ads, no analytics SDKs.** Data is not sold, rented, or
  shared. It is sent only to the organisation's own server for the internal
  operational purpose above.
- **Local storage:** metric events are buffered on-device in `chrome.storage.local`
  and deleted as soon as they are acknowledged by the server (and swept after 7
  days regardless). Status heartbeats are fire-and-forget (not buffered).
- **Deletion:** an operator's record can be erased via an **administrator-only**
  server function (used for offboarding / data requests). It is not self-service,
  consistent with the mandatory-collection model.

## 5. Permissions justification

| Permission | Used for |
|---|---|
| `notifications` | Desktop notifications for incoming calls (existing). |
| `storage` | Save settings and buffer metric events locally (existing + metrics). |
| `offscreen` | Play the ringtone from the MV3 service worker (existing). |
| `idle` | Detect screen lock to stop ringing / set presence, exclude locked/idle time from "available", and set live status to "away" (existing + metrics). |
| `alarms` | Periodic (1-min) flush of buffered metrics and availability accounting (metrics); 30-min remote kill-switch check. |
| Host permission `*://*.dynamics.com/*` | Detect the incoming-call popup and read presence in Dynamics (existing). |
| Host permission for the metrics-server origin | Send metrics and status to the organisation's server. A **required** host permission in this internal build (metrics are always on). |
| Host permission `https://dns.google/*` | Remote kill switch: a DNS-over-HTTPS TXT lookup for a fixed admin-controlled hostname every 30 minutes. If the record is present the extension disables itself ("Disabled by admin"). No user data is sent. |
| Microphone | Only to enumerate audio *output* device names so the operator can pick a speaker. The microphone is never recorded, listened to, or transmitted (existing). |

## 6. Certifications (for the CWS form)

- The extension's use of data complies with the Chrome Web Store Developer Program
  Policies.
- Data is **not** sold to third parties.
- Data is **not** used or transferred for purposes unrelated to the extension's
  single purpose.
- Data is **not** used or transferred to determine creditworthiness or for lending
  purposes.

## 7. Reviewer notes

- This is an **unlisted, internal enterprise** extension deployed to company
  devices; Team Metrics is a documented condition of use, disclosed in-product and
  in `PRIVACY-POLICY.md`.
- The only direct personal datum transmitted is the operator's first name;
  everything else is numeric/aggregate, a live status value, or a random device
  tag.
- Ingest is network-restricted (CIDR allowlist); the dashboard is behind HTTP
  Basic auth. No request IPs are stored with metrics.
