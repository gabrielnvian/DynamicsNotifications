# Chrome Web Store — Submission Materials (Dynamics Notifications v1.7)

Ready-to-paste content for the CWS developer dashboard. Every line is grounded in
the actual shipped code (verified by an adversarial submission-readiness review).

**Distribution:** Unlisted, internal enterprise extension — force-installed by the
employer on company devices; not offered to the public.

**Pre-submission fixes applied (this build):**
- Microphone is no longer requested at install — `getUserMedia` is deferred until the
  operator opens the popup's audio-output picker (`background.js` `initOffscreen`).
- `manifest.json` `description` now discloses the metrics/availability reporting.

---

## 1. Descriptions

**Manifest / short description** (already set in `manifest.json`, 126 chars):
> Incoming-call alerts for Dynamics 365 Omnichannel, plus call-handling metrics and availability reporting to your org's server.

**Detailed store description** (paste in the listing):
> Dynamics Notifications alerts Microsoft Dynamics 365 Omnichannel operators to
> incoming calls with loud audio, desktop notifications, and full-screen in-page
> visuals so a call is never missed. As a condition of use on company devices, it
> also records aggregate call-handling metrics (available time, calls
> received/answered, time-to-answer) and a periodic availability status, and reports
> them over HTTPS to a single self-hosted server that the operator's organization
> runs and controls. It communicates only with the operator's own Dynamics 365 tab
> and that one organization server — no third parties.

## 2. Permission justifications (one per "why do you need this" box)

- **`notifications`** — Fire the incoming-call desktop notification, re-fired every 6s with `requireInteraction`, cleared on click/dismiss or call end. Core alert channel.
- **`storage`** — User preferences in `chrome.storage.sync` (volume, ringtone, audio output, alert toggles, lock behavior); buffer the metric-event queue, availability clock, and retry-backoff in `chrome.storage.local`; transient call/presence state in `chrome.storage.session`.
- **`offscreen`** — MV3 service workers can't play audio or call `getUserMedia`. The offscreen document (`reasons: ['AUDIO_PLAYBACK','USER_MEDIA']`) plays the looping ringtone and enumerates audio output devices.
- **`idle`** — Detect screen lock/idle (`onStateChanged`/`queryState`) to stop ringing on lock, optionally set Dynamics presence to Busy and auto-close Dynamics tabs, and set live status to "away" while locked. Only the locked/idle/active state is read — never keystrokes or content.
- **`alarms`** — A single 1-minute periodic alarm that accrues availability seconds, flushes the buffered metric queue, sweeps stale events, and sends a presence keepalive.
- **Host `*://*.dynamics.com/*`** — Inject the content script to detect the incoming-call popup and read the presence label, and to locate/focus/close the Dynamics tab via host-scoped `chrome.tabs.query`. No broad `tabs` permission is requested.
- **Host `https://dynops.tail068f9.ts.net/*`** — The single organization-controlled endpoint. POSTs metrics to `/v1/events` and presence to `/v1/presence` over HTTPS. The only network origin contacted.
- **Microphone (runtime `getUserMedia`, not a manifest permission)** — Chrome only reveals audio-*output* device labels after a mic grant. The offscreen document opens an audio stream **only when the operator opens the audio-output picker**, solely to populate the speaker list, then immediately stops every track. No audio is ever recorded, listened to, buffered, or transmitted. Surfaced to the user in the popup.

## 3. Data safety / privacy practices

**Data collected (transmitted off-device), by CWS category:**

| CWS data type | Collected? | What exactly |
|---|---|---|
| **PII → Name** | **Yes** | Operator **first name only** (first token, regex-validated, ≤40 chars), read from the signed-in M365 account control. The only direct personal identifier sent. |
| **PII → other identifier** | **Yes (pseudonymous)** | A random `crypto.randomUUID()` install ID. Not derived from any account/hardware/personal detail; never joined to an IP server-side. |
| **User activity** | **Yes** | Aggregate per-local-day numbers: available seconds, calls received/answered (counts), time-to-answer (ms); plus a periodic availability enum (`available`/`away`). |
| Web history | No | No URLs, titles, or browsing history. |
| Website content | No (local only) | Caller name from the popup is read only to render the on-screen alert; never stored/logged/transmitted. |
| Location / Financial / Health / Auth / Personal comms | No | None. No IP, geolocation, fingerprint, user-agent, **email**, username, full name, or Dynamics account ID. |

- **Sold or shared with third parties:** **No.** No third parties, ad networks, or analytics SDKs.
- **Encrypted in transit:** **Yes** — all transmission is HTTPS.
- **Deletion:** on-device events are removed as soon as the server acknowledges them (7-day sweep backstop); server-side erasure is an **administrator-only** function (offboarding / data requests), not self-service (mandatory-collection model).
- **Privacy certifications (all true):** not sold/transferred to third parties · not used for unrelated purposes · not used for creditworthiness/lending.
- **Privacy policy URL:** host the shipped `PRIVACY-POLICY.md` at a stable URL — it already matches the code exactly.

## 4. Reviewer notes (paste in the reviewer-notes box)

- **Unlisted internal enterprise extension**, force-installed by the employer on US-employee company devices; not public. Team-metrics collection is a documented condition of use, disclosed in-product (popup "Team Metrics" section) and in `PRIVACY-POLICY.md`. There is intentionally no end-user opt-out.
- **Only one personal field leaves the device: the operator's first name** (validated, ≤40 chars) + a random install UUID. Everything else transmitted is numeric/aggregate or an enum. Payloads are built from a constant allowlist on-device and re-validated server-side. **No email, account ID, or web history is ever read or sent.**
- **Microphone** is a runtime `getUserMedia` grant from the offscreen document, requested **only when the operator opens the audio-output picker**, used solely to unlock output-device *labels*; the stream is stopped immediately and no audio is captured.
- **Tab focus/close** uses host-permission-scoped `chrome.tabs.query` — **no broad `tabs` permission**.
- **Live-call handle-time + `on_call` status are gated OFF** in this build (`CALL_TRACKING_ENABLED = false`); v1.7 emits only call-received / answered (time-to-answer) / availability ticks / `available`+`away` status. Handle time is listed as "a later version" in the disclosure to match.
- **No remote code, no eval, no third-party calls.** The only non-HTTPS fetches are `chrome.runtime.getURL()` loads of the bundled ringtone MP3s.

## 5. Package contents (the uploaded zip)

`manifest.json`, `background.js`, `content.js`, `metrics.js`, `popup.{html,js,css}`,
`offscreen.{html,js}`, `icons/icon{16,48,128}.png`, four ringtone `.mp3`s. **Nothing
else** — no `server/`, `docs/`, `node_modules`, or repo config.
