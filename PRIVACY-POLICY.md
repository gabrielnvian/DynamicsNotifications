# Dynamics Notifications — Privacy Policy

**Effective date:** 2026-04-15

Dynamics Notifications is a Chrome extension that plays audible and visual alerts when an incoming call is detected in Microsoft Dynamics 365 Omnichannel.

## Data we collect

**None.** The extension does not collect, transmit, sell, or share any personal data, telemetry, or usage analytics. No data leaves your browser.

## Data we access locally

- **Caller name from the Dynamics 365 call popup.** Used only to display the caller in the on-screen alert. Never stored, logged, or transmitted.
- **Your alert preferences** (volume, ringtone, enabled alert types, selected audio output device). Stored via `chrome.storage.sync`, which syncs to your own Google account only. We have no access to it.

## Permissions and why we need them

- **`notifications`** — to show desktop notifications for incoming calls.
- **`storage`** — to remember your preferences across sessions.
- **`offscreen`** — required by Chrome Manifest V3 to play ringtone audio from a background service worker.
- **`idle`** — to detect when you lock your computer so the extension can stop ringing and (optionally) set your Dynamics presence to Away. Only the lock state is used; no keystroke or activity timing is read or transmitted.
- **Host permission for `*.dynamics.com`** — to detect the incoming-call popup inside your Dynamics 365 tab. The extension runs nowhere else.
- **Microphone access** — Chrome requires microphone permission to enumerate audio output devices *by name* (so you can pick a specific speaker). The microphone is never recorded, listened to, or transmitted. The stream is opened briefly and immediately closed.

## Third parties

The extension does not contact any third-party server. It communicates only with the Dynamics 365 tab you already have open.

## Contact

Questions: gvian07@gmail.com
