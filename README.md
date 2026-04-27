# Dynamics Notifications

Aggressive alerts for incoming calls in Dynamics 365 Omnichannel — never miss a call again.

Dynamics' default call popup is easy to miss if you're in another tab or window. This Chrome extension adds loud, impossible-to-ignore alerts the moment a call comes in.

## Features

- **Ringtone** — plays a custom ringtone on any audio output device (4 built-in sounds: Agent, Teams Remix, Discord, Skype)
- **Desktop notification** — system-level notification that shows even when Chrome is minimized
- **In-page alert card** — large centered popup with the caller's name; click to dismiss
- **Pulsing border** — animated blue border around the entire viewport
- **Fullscreen flash** — subtle pulsing overlay so the screen is visible from across the room
- **Auto-Busy on lock** — optionally sets your Dynamics presence to Busy when the computer is locked and restores it on unlock
- **Auto-close on lock** — optionally closes Dynamics tabs 10 seconds after the computer is locked (cancelled if you unlock first)

Each alert type can be toggled independently from the popup.

## Installation

1. Clone or download this repo.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select the project folder.
4. Pin the extension and open any `*.dynamics.com` page.

## Usage

- Click the extension icon to configure volume, ringtone, audio output, and which alert types are active.
- Press **Test Alerts** to preview.
- Press **Esc** or click the alert card to dismiss.
- Accept/Decline buttons in the Dynamics popup automatically stop alerts.

## Permissions

- `notifications` — desktop notifications on incoming calls
- `storage` — save your settings
- `offscreen` — play audio from the service worker
- `idle` — detect screen lock for auto-presence
- `*://*.dynamics.com/*` — only runs on Dynamics pages

No data leaves your browser. See `PRIVACY-POLICY.md`.

## Files

| File | Purpose |
|---|---|
| `manifest.json` | Extension manifest (MV3) |
| `background.js` | Service worker — notifications, audio routing, idle detection |
| `content.js` | Injected into Dynamics — detects call popups, renders visual alerts |
| `offscreen.html` / `offscreen.js` | Offscreen document for audio playback |
| `popup.html` / `popup.js` / `popup.css` | Settings popup |
| `*.mp3` | Ringtones |
