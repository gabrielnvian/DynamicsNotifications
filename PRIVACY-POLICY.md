# Dynamics Notifications — Privacy & Data Notice

**Effective date:** 2026-07-01

Dynamics Notifications is an internal Chrome extension distributed by the operator's
employer to company devices (unlisted; not offered to the public). It plays audible
and visual alerts for incoming calls in Microsoft Dynamics 365 Omnichannel and,
as a condition of use on company systems, records **team call-handling metrics**
per employer policy. This notice describes exactly what is recorded and where it
goes.

## Team Metrics (recorded per employer policy)

Call-handling metrics are recorded whenever you are signed in to Dynamics 365 with
the extension installed. They are sent to a metrics server that your organisation
runs and controls. The following is transmitted, and **nothing else**:

**Personal data**
- **Your first name** — the first name only (first word; letters and simple
  punctuation, up to 40 characters), detected from the Microsoft 365 account you
  are signed into. This is the only direct personal identifier transmitted.
- **An anonymous device ID** — a random identifier generated on your device, not
  derived from any account, hardware, or personal detail, and never linked to your
  IP address on the server. It only lets the server tell apart two people who share
  a first name and de-duplicate re-sent data.

**Non-personal, aggregate numbers** (per day)
- Seconds you were available/eligible to take calls.
- Number of calls received and number answered.
- Time-to-answer (ring to pickup) and, in a later version, handle time.

**Current status (live board)**
- A periodic status heartbeat — one of **available**, **on a call**, **away**, or
  **offline** — so your team lead can see current availability. No caller data is
  included; "offline" is inferred by the server when heartbeats stop.

**Technical fields:** the extension version, a schema version, a batch/event
identifier, and timestamps.

**We never record or transmit:** caller names, caller phone numbers, call audio,
recordings or transcripts, your full name, email, username or Dynamics account ID,
message/page content, URLs, browsing history, IP address, geolocation, or device
fingerprint. Payloads are built from a fixed allowlist on your device and
re-validated by the server, which rejects anything outside that list.

**Where it goes:** only to the single self-hosted server your organisation runs —
over HTTPS. No third parties, ad networks, or analytics SDKs are involved, and the
data is never sold or shared.

**Your controls & data requests:** metrics are recorded as a condition of using the
extension on company systems and cannot be turned off from the extension. Requests
to access or erase your metrics are handled by your organisation's administrator
(the server provides an admin-only deletion function); contact your team lead or
IT administrator.

## Data accessed locally (not transmitted)

- **Caller name from the Dynamics 365 call popup** — used only to display the
  caller in the on-screen alert. Never stored, logged, or transmitted.
- **Your preferences** (volume, ringtone, alert types, audio output). Stored via
  `chrome.storage.sync`, which syncs to your own Google account only.

## Permissions and why we need them

- **`notifications`** — desktop notifications for incoming calls.
- **`storage`** — remember your preferences and buffer metric events locally.
- **`offscreen`** — required by Chrome Manifest V3 to play ringtone audio from a
  background service worker.
- **`idle`** — detect when you lock your computer (to stop ringing, optionally set
  presence, and exclude locked/idle time from "available" and set your status to
  "away"). Only the lock/idle state is used; no keystroke or activity content is
  read.
- **`alarms`** — periodic, low-frequency processing of Team Metrics, and the
  30-minute remote disable check.
- **Host permission for `*.dynamics.com`** — to detect the incoming-call popup and
  read your presence inside your Dynamics 365 tab.
- **Host permission for the metrics server** — to send metrics and status to your
  organisation's server.
- **Host permission for `dns.google`** — for the remote disable check described
  below.
- **Microphone** — Chrome requires microphone permission to enumerate audio output
  devices *by name* so you can pick a specific speaker. The microphone is never
  recorded, listened to, or transmitted; the stream is opened briefly and
  immediately closed.

## Third parties

Apart from the remote disable check below, the extension contacts no third-party
server. It communicates only with the Dynamics 365 tab you already have open, your
organisation's metrics server, and Google Public DNS.

**Remote disable check:** about every 30 minutes (and at browser start) the
extension sends a DNS-over-HTTPS lookup to Google Public DNS (`dns.google`) for a
fixed TXT record controlled by the deployment administrator. If the record is
present, the extension disables itself and shows "Disabled by admin". The request
contains only that fixed hostname — no personal data, settings, or metrics — though,
like any web request, Google receives your IP address.

## Contact

Questions about this notice or a data request: your team lead / IT administrator
(deployment contact: gvian07@gmail.com).
