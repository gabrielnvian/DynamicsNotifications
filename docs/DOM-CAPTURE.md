# Dynamics DOM Capture — Phase-0 selector brief

Goal: capture the exact selectors/attributes the metrics extension needs from a
**live Dynamics 365 Omnichannel** tenant, so the content-script code can be
finalised against real values instead of guesses.

An agent (or a person) with the authenticated portal open runs the snippet below
in the browser **DevTools console** (or via a browser agent's `evaluate`) in the
UI states listed, and sends back each JSON output labelled by state.

## What we need to nail down
1. Presence button + the exact `aria-label` text per presence state, and the
   presence-menu item `data-id`s.
2. The logged-in operator's **name element** (for auto first-name; only the first
   token is ever used).
3. Re-confirm the incoming-call popup selectors.
4. The **session-tab list** container + per-tab element (handle-time end = the
   call's tab detaching), plus any **call-duration timer** and the End button.

## The capture snippet

```js
(() => {
  const pick = (el) => el && {
    tag: el.tagName?.toLowerCase(),
    id: el.id || null,
    dataId: el.getAttribute?.('data-id') || null,
    ariaLabel: el.getAttribute?.('aria-label') || null,
    title: el.getAttribute?.('title') || null,
    role: el.getAttribute?.('role') || null,
    className: typeof el.className === 'string' ? el.className : null,
    text: (el.textContent || '').trim().slice(0, 140) || null,
    outerHTMLHead: (el.outerHTML || '').slice(0, 600),
  };
  const q  = (s) => { try { return document.querySelector(s); } catch { return null; } };
  const qa = (s) => { try { return [...document.querySelectorAll(s)]; } catch { return []; } };
  const deep = (el) => el && { ...pick(el), outerHTML: (el.outerHTML || '').slice(0, 2500) };

  const out = {
    url: location.href,
    lang: document.documentElement.lang || null,
    ts: new Date().toISOString(),
  };

  // 1. Presence (open the presence menu BEFORE running to capture menu items)
  out.presence = {
    button: pick(q('button[data-id="Microsoft.Dyanmics.Service.CIFramework.Presence.NewPresenceControlButton"]')),
    buttonFallbacks: qa('[data-id*="Presence" i], [aria-label*="presence" i]').slice(0, 8).map(pick),
    menuItems: qa('[data-id^="presencestatus-"]').map(pick),
  };

  // 2. Logged-in user / name (top-right shell "me" control)
  out.user = qa(
    '#mectrl_main_trigger, #mectrl_currentAccount_primary, .mectrl_name, ' +
    '#O365_MainLink_Me, [aria-label*="account manager" i], [data-id*="usermenu" i], ' +
    '[aria-label*="signed in" i]'
  ).slice(0, 10).map(pick);

  // 3. Incoming call popup (re-confirm)
  out.ringing = {
    popup:    pick(q('#popupNotificationRoot')),
    phone:    pick(q('#popupNotificationRoot img[src*="phonecallicon"]')),
    header:   pick(q('#popupNotificationHeaderText')),
    accept:   pick(q('#acceptButton')),
    decline:  pick(q('#declineButton')),
    waitTime: pick(q('[data-id="popup-notification-waitTime"]')),
  };

  // 4. Session panel / tabs + call-control + timer (capture DURING a live call)
  out.sessions = {
    byDataId: qa('[data-id*="session" i]').slice(0, 25).map(pick),
    tablists: qa('[role="tablist"]').slice(0, 10).map(deep),
    tabs:     qa('[role="tab"]').slice(0, 25).map(pick),
    likelyContainer: deep(q('[data-id*="sessionPanel" i], [data-id*="agentContainer" i], [id*="session" i]')),
  };
  out.callControls = qa(
    '[data-id*="call" i][role], [aria-label*="hang up" i], [aria-label*="end call" i], ' +
    '[data-id*="callControl" i], [data-id*="conversationControl" i]'
  ).slice(0, 20).map(pick);
  // ticking mm:ss / hh:mm:ss leaf nodes (possible call timer)
  out.timers = qa('*')
    .filter((el) => el.children.length === 0 && /^\d{1,2}:\d{2}(:\d{2})?$/.test((el.textContent || '').trim()))
    .slice(0, 15).map(pick);

  const json = JSON.stringify(out, null, 2);
  console.log(json);
  try { copy(json); console.log('%c[copied to clipboard]', 'color:green'); } catch {}
  return out;
})();
```

## States to run it in (label each output)

- **STATE A — idle, presence menu OPEN.** Click the presence control so the
  status list is showing, then run. (Gives the exact per-status `data-id`s + the
  current `aria-label`.) If easy, also switch to each status and note the
  button's `aria-label` text for Available / Busy / Do Not Disturb / Away /
  Offline.
- **STATE B — a call is RINGING.** Run while the incoming popup is up.
- **STATE C — call CONNECTED (after Accept).** Run while actively on the call —
  this is the important one for the session-tab container, the tabs, the
  call-control panel, and any duration timer.
- **STATE D — WRAP-UP (after End, before closing the session)**, then **after
  closing the session.** Run once in each so we can see which element disappears
  when the session closes (that removal is the handle-time end signal).

To reach C/D you'll need a test call (have someone call the queue, or place one).
If that's not possible now, send A + B + the user capture, and grab C/D whenever a
real call happens.

## Send back
The JSON from each state (A–D), labelled. Paste inline, or `cohub push` the file
to `webstorm`. From those I'll lock the presence label, the session-tab selector
(handle-time end), the first-name element, and confirm the popup selectors.

## Privacy note
The capture may include the caller name and the operator's full name — that's
fine to share for selector analysis; it is **not** what the feature transmits.
The shipped feature sends only the operator's **first name** (first token) plus
aggregate numbers.
