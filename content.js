// Dynamics Notifications — Content Script (content.js)
// Detects incoming call popups and fires visual/audio alerts

(() => {
  // Guard against duplicate injection
  if (window.__dynamicsNotifInjected) return;
  window.__dynamicsNotifInjected = true;

  // ── Settings ──────────────────────────────────────────────────────────
  const DEFAULT_SETTINGS = {
    enabled: true,
    volume: 1.0,
    alertSound: true,
    alertNotification: true,
    alertWindow: true,
    alertVisualOverlay: true,
    alertFullscreenFlash: true
  };

  let settings = { ...DEFAULT_SETTINGS };

  chrome.storage.sync.get(DEFAULT_SETTINGS, (stored) => {
    settings = { ...DEFAULT_SETTINGS, ...stored };
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const [key, { newValue }] of Object.entries(changes)) {
      if (key in settings) settings[key] = newValue;
    }
    // Volume changes are handled by the offscreen document via background.js
  });

  // ── Safe Messaging ─────────────────────────────────────────────────
  // Wraps chrome.runtime.sendMessage to handle "Extension context invalidated"
  // which happens when the extension is reloaded but the old content script is still alive
  let contextValid = true;

  function safeSendMessage(message) {
    if (!contextValid) return;
    try {
      chrome.runtime.sendMessage(message).catch(() => { invalidateContext(); });
    } catch (_) {
      invalidateContext();
    }
  }

  function invalidateContext() {
    contextValid = false;
    // Clean up everything — this script is orphaned
    stopBorderPulse();
    stopFlashOverlay();
    stopAlertCard();
    if (pollingInterval) { clearInterval(pollingInterval); pollingInterval = null; }
    if (maxAlertTimeout) { clearTimeout(maxAlertTimeout); maxAlertTimeout = null; }
    observer.disconnect();
    console.log('[Dynamics Notifications] Extension was reloaded — this content script is now inactive. Refresh the page.');
  }

  // ── State ─────────────────────────────────────────────────────────────
  let metricsCheck = null; // set by the Team Metrics sensor block below
  let alertsActive = false;
  let dismissedCallHeader = null;
  let pollingInterval = null;
  let maxAlertTimeout = null;
  let flashOverlay = null;
  let alertCard = null;
  let styleElement = null;

  // ── CSS Injection ─────────────────────────────────────────────────────
  function injectStyles() {
    if (styleElement) return;
    styleElement = document.createElement('style');
    styleElement.id = 'dynamics-notif-styles';
    styleElement.textContent = `
      @keyframes dynamics-notif-pulse-border {
        0%, 100% { box-shadow: inset 0 0 0 6px rgba(0, 98, 165, 0.9); }
        50% { box-shadow: inset 0 0 0 6px rgba(0, 98, 165, 0.3); }
      }
      .dynamics-notif-border-active {
        animation: dynamics-notif-pulse-border 0.8s ease-in-out infinite !important;
      }
      @keyframes dynamics-notif-flash-overlay {
        0%, 100% { opacity: 0.18; }
        50% { opacity: 0.02; }
      }
      #dynamics-notif-flash-overlay {
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        background: #0062A5 !important;
        pointer-events: none !important;
        z-index: 2147483646 !important;
        animation: dynamics-notif-flash-overlay 1s ease-in-out infinite !important;
      }
      @keyframes dynamics-notif-shake {
        0%, 100% { transform: rotate(0deg); }
        20% { transform: rotate(15deg); }
        40% { transform: rotate(-15deg); }
        60% { transform: rotate(10deg); }
        80% { transform: rotate(-10deg); }
      }
      @keyframes dynamics-notif-card-pulse {
        0%, 100% { box-shadow: 0 0 30px rgba(0, 98, 165, 0.8), 0 0 60px rgba(0, 98, 165, 0.4); }
        50% { box-shadow: 0 0 50px rgba(0, 98, 165, 1), 0 0 100px rgba(0, 98, 165, 0.6); }
      }
      #dynamics-notif-alert-card {
        position: fixed !important;
        top: 50% !important;
        left: 50% !important;
        transform: translate(-50%, -50%) !important;
        width: 400px !important;
        padding: 32px !important;
        background: #0062A5 !important;
        color: #fff !important;
        border-radius: 16px !important;
        z-index: 2147483647 !important;
        text-align: center !important;
        font-family: system-ui, -apple-system, sans-serif !important;
        cursor: pointer !important;
        animation: dynamics-notif-card-pulse 1.5s ease-in-out infinite !important;
      }
      #dynamics-notif-alert-card .dn-phone {
        font-size: 64px !important;
        display: block !important;
        margin-bottom: 12px !important;
        animation: dynamics-notif-shake 0.5s ease-in-out infinite !important;
      }
      #dynamics-notif-alert-card .dn-title {
        font-size: 26px !important;
        font-weight: 700 !important;
        margin-bottom: 8px !important;
      }
      #dynamics-notif-alert-card .dn-caller {
        font-size: 18px !important;
        opacity: 0.9 !important;
        margin-bottom: 16px !important;
      }
      #dynamics-notif-alert-card .dn-hint {
        font-size: 13px !important;
        opacity: 0.7 !important;
      }
    `;
    document.head.appendChild(styleElement);
  }

  // ── Pulsing Border ────────────────────────────────────────────────────
  function startBorderPulse() {
    if (!settings.alertVisualOverlay) return;
    injectStyles();
    document.documentElement.classList.add('dynamics-notif-border-active');
  }

  function stopBorderPulse() {
    document.documentElement.classList.remove('dynamics-notif-border-active');
  }

  // ── Fullscreen Flash Overlay ──────────────────────────────────────────
  function startFlashOverlay() {
    if (!settings.alertFullscreenFlash) return;
    injectStyles();
    if (flashOverlay) return;
    flashOverlay = document.createElement('div');
    flashOverlay.id = 'dynamics-notif-flash-overlay';
    document.body.appendChild(flashOverlay);
  }

  function stopFlashOverlay() {
    if (flashOverlay) {
      flashOverlay.remove();
      flashOverlay = null;
    }
  }

  // ── Alert Card (in-page popup) ──────────────────────────────────────
  function startAlertCard(callerInfo) {
    if (!settings.alertWindow) return;
    injectStyles();
    if (alertCard) return;
    alertCard = document.createElement('div');
    alertCard.id = 'dynamics-notif-alert-card';

    const phone = document.createElement('span');
    phone.className = 'dn-phone';
    phone.textContent = '☎️';

    const title = document.createElement('div');
    title.className = 'dn-title';
    title.textContent = 'INCOMING CALL';

    const caller = document.createElement('div');
    caller.className = 'dn-caller';
    caller.textContent = callerInfo;

    const hint = document.createElement('div');
    hint.className = 'dn-hint';
    hint.textContent = 'Click here to stop ringtone';

    alertCard.append(phone, title, caller, hint);
    alertCard.addEventListener('click', () => {
      const popup = document.querySelector('#popupNotificationRoot');
      dismissedCallHeader = popup?.querySelector('#popupNotificationHeaderText')?.textContent?.trim() || null;
      stopAllAlerts();
    });
    document.body.appendChild(alertCard);
  }

  function stopAlertCard() {
    if (alertCard) {
      alertCard.remove();
      alertCard = null;
    }
  }

  // ── Alert Orchestration ───────────────────────────────────────────────
  function startAllAlerts(callerInfo, isTest) {
    if (alertsActive) return;
    alertsActive = true;

    console.log('[Dynamics Notifications] 🔔 Incoming call detected:', callerInfo);

    // Audio + notifications are handled by background.js via offscreen document
    startBorderPulse();
    startFlashOverlay();
    startAlertCard(callerInfo);

    // Notify background for desktop notification + badge
    safeSendMessage({
      type: 'CALL_DETECTED',
      callerInfo: callerInfo
    });

    if (!isTest) {
      // Attach click listeners to Accept/Reject buttons
      attachButtonListeners();

      // Start safety-net polling to detect popup disappearance or content changes
      pollingInterval = setInterval(() => {
        const popup = document.querySelector('#popupNotificationRoot');

        // Popup gone from DOM
        if (!popup) {
          stopAllAlerts();
          return;
        }

        // Popup hidden via CSS (display:none, visibility:hidden, zero size)
        const rect = popup.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) {
          stopAllAlerts();
          return;
        }

        // Phone icon gone — popup changed to a non-call state (e.g. "disconnected")
        const phoneIcon = popup.querySelector('img[src*="phonecallicon"]');
        if (!phoneIcon) {
          stopAllAlerts();
          return;
        }

        // Countdown reached 0
        const countdown = popup.querySelector('[data-id="popup-notification-waitTime"]');
        if (countdown) {
          const text = countdown.textContent.trim();
          if (text === '0 sec' || text === '0') {
            stopAllAlerts();
          }
        }
      }, 500);

      // Hard max timeout — force stop after 25 seconds no matter what
      // Dynamics call popups timeout at ~20s, so this catches any edge case
      maxAlertTimeout = setTimeout(() => {
        if (alertsActive) {
          console.log('[Dynamics Notifications] Max alert timeout reached (25s), force stopping');
          stopAllAlerts();
        }
      }, 25000);
    }
  }

  function stopAllAlerts(notifyBackground = true) {
    if (!alertsActive) return;
    alertsActive = false;

    console.log('[Dynamics Notifications] Alerts stopped');

    // Mark this call as dismissed so the MutationObserver won't re-trigger
    // for the same popup that may still be in the DOM
    if (!dismissedCallHeader) {
      const popup = document.querySelector('#popupNotificationRoot');
      dismissedCallHeader = popup?.querySelector('#popupNotificationHeaderText')?.textContent?.trim() || '__dismissed__';
    }

    stopBorderPulse();
    stopFlashOverlay();
    stopAlertCard();

    if (pollingInterval) {
      clearInterval(pollingInterval);
      pollingInterval = null;
    }
    if (maxAlertTimeout) {
      clearTimeout(maxAlertTimeout);
      maxAlertTimeout = null;
    }

    if (notifyBackground) {
      safeSendMessage({ type: 'CALL_ENDED' });
    }
  }

  // ── Button Listeners ──────────────────────────────────────────────────
  function attachButtonListeners() {
    const accept = document.querySelector('#acceptButton');
    const decline = document.querySelector('#declineButton');

    const handler = () => {
      // Mark this call's header as dismissed so we don't re-trigger for the same popup
      const popup = document.querySelector('#popupNotificationRoot');
      dismissedCallHeader = popup?.querySelector('#popupNotificationHeaderText')?.textContent?.trim() || null;
      stopAllAlerts();
    };

    if (accept) accept.addEventListener('click', handler, { once: true });
    if (decline) decline.addEventListener('click', handler, { once: true });
  }

  // ── DOM Observation ───────────────────────────────────────────────────
  function isPhoneCallPopup(element) {
    if (!element || element.id !== 'popupNotificationRoot') return false;
    const img = element.querySelector('img[src*="phonecallicon"]');
    return !!img;
  }

  function checkForPopup() {
    if (!contextValid || !settings.enabled) return;

    const popup = document.querySelector('#popupNotificationRoot');

    // No popup on screen — clear dismissed flag so next call triggers
    if (!popup) {
      if (dismissedCallHeader) {
        dismissedCallHeader = null;
      }
      if (alertsActive) {
        stopAllAlerts();
      }
      return;
    }

    // Popup exists — check if it's a phone call we should alert for
    if (!alertsActive && isPhoneCallPopup(popup)) {
      const headerText = popup.querySelector('#popupNotificationHeaderText')?.textContent?.trim() || 'Incoming Call';

      // If this is the same call we already dismissed, skip it
      if (dismissedCallHeader && dismissedCallHeader === headerText) {
        return;
      }

      // New call (or different call) — clear old dismissal and alert
      dismissedCallHeader = null;
      startAllAlerts(headerText);
    }
  }

  const observer = new MutationObserver(() => {
    checkForPopup();
    if (metricsCheck) metricsCheck();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  // Initial scan — catch popups already on screen when the script loads
  checkForPopup();

  // ── Presence toggling on lock/unlock ──────────────────────────────────
  const PRESENCE_BUTTON_SEL = 'button[data-id="Microsoft.Dyanmics.Service.CIFramework.Presence.NewPresenceControlButton"]';

  function waitForElement(selector, timeout) {
    return new Promise((resolve) => {
      const existing = document.querySelector(selector);
      if (existing) { resolve(existing); return; }
      const start = Date.now();
      const check = () => {
        const el = document.querySelector(selector);
        if (el) { resolve(el); return; }
        if (Date.now() - start > timeout) { resolve(null); return; }
        requestAnimationFrame(check);
      };
      check();
    });
  }

  function simulateClick(el) {
    // Fluent UI sometimes ignores plain .click() — dispatch full pointer+mouse sequence
    const opts = { bubbles: true, cancelable: true, view: window, button: 0 };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
  }

  async function changePresence(targetStatus) {
    const button = document.querySelector(PRESENCE_BUTTON_SEL);
    if (!button) {
      console.warn('[Dynamics Notifications] Presence button not found');
      return false;
    }
    console.log('[Dynamics Notifications] Opening presence dropdown');
    simulateClick(button);

    const itemSel = `button[data-id="presencestatus-${targetStatus}"]`;
    const item = await waitForElement(itemSel, 3000);
    if (!item) {
      console.warn('[Dynamics Notifications] Presence option not found:', targetStatus);
      simulateClick(document.querySelector(PRESENCE_BUTTON_SEL));
      return false;
    }
    console.log('[Dynamics Notifications] Selecting status:', targetStatus);
    simulateClick(item);
    return true;
  }

  const LOCK_STATUS = 'busy';

  async function handleLockSetPresence() {
    const { lockAutoPresence } = await chrome.storage.sync.get({ lockAutoPresence: true });
    if (!lockAutoPresence) return;

    const button = document.querySelector(PRESENCE_BUTTON_SEL);
    if (!button) return;

    const current = button.getAttribute('aria-label')?.trim().toLowerCase();
    if (!current || current === LOCK_STATUS) return;

    await chrome.storage.session.set({ savedPresence: current });
    await changePresence(LOCK_STATUS);
  }

  async function handleLockRestorePresence() {
    const { lockAutoPresence } = await chrome.storage.sync.get({ lockAutoPresence: true });
    if (!lockAutoPresence) return;

    const { savedPresence } = await chrome.storage.session.get('savedPresence');
    if (!savedPresence) return;

    const button = document.querySelector(PRESENCE_BUTTON_SEL);
    if (!button) { await chrome.storage.session.remove('savedPresence'); return; }

    const current = button.getAttribute('aria-label')?.trim().toLowerCase();
    // Only restore if current status still matches the lock status — user may have changed it manually
    if (current !== LOCK_STATUS) {
      await chrome.storage.session.remove('savedPresence');
      return;
    }

    await changePresence(savedPresence);
    await chrome.storage.session.remove('savedPresence');
  }

  // ── Team Metrics sensors (mandatory; fully decoupled from the alert path) ─
  // Emits METRIC_* messages only; background.js does all storage/delivery.
  // Never reads caller data.
  (() => {
    // Selectors confirmed live on the csusm tenant (RED, cohub #1999):
    const AVAILABLE_LABEL = 'available';                                      // presence aria-label === "Available"
    const NAME_SEL = '#mectrl_currentAccount_primary';                        // O365 "me" control → full name (first token only)
    // The call opens a conversation SESSION tab: <div|button role="tab" id="session-id-N">.
    // On this tenant the CALL tab is a <div> (Home/Inbox are <button>s), so match by
    // role + id, NOT by tag — that one-tag assumption was the original miss (cohub #2232).
    const SESSION_TAB_SEL = '[role="tab"][id^="session-id-"]';

    // Live call tracking = Phase B. Drives BOTH the "on_call" live status and the
    // handle-time metric. Live-validated (cohub #2232/#2235): a voice call opens a new
    // session tab on accept; it detaches when the conversation session CLOSES — the end
    // of wrap-up. So duration = accept → close = handle time incl. wrap-up ("call time"),
    // and on_call holds through wrap-up until the session closes. The [calltrack] console
    // logs narrate the lifecycle for DevTools diagnosis.
    const CALL_TRACKING_ENABLED = true;
    const HANDLE_CAP_MS = 4 * 60 * 60 * 1000;
    const TAB_WAIT_MS = 30000;   // generous window for the session tab to appear after accept
    const ct = (...a) => console.log('[Dynamics Notifications][calltrack]', ...a);

    const HEARTBEAT_MS = 5_000;    // live-board keepalive while a Dynamics tab is open (on-change beats fire immediately)

    let lastAvailable = null;
    let inCallLocal = false;
    let ringKey = null, tRing = 0, tAnswer = 0, preTabIds = [];
    let handleObserver = null, handleCap = null, tabPoll = null, trackedTab = null;

    // — Auto first-name from Dynamics (first token only; never the full name) —
    async function detectFirstName() {
      const el = document.querySelector(NAME_SEL);
      const full = (el?.textContent || el?.getAttribute('aria-label') || '').trim();
      if (!full) return;
      const first = full.split(/\s+/)[0].slice(0, 40);
      if (!/^\p{L}[\p{L}.'\-]*$/u.test(first)) return;
      try {
        const { metricsFirstName } = await chrome.storage.sync.get({ metricsFirstName: '' });
        // Track the currently signed-in operator so metrics always attribute to the
        // person actually logged into Dynamics (handles shared workstations).
        if (metricsFirstName !== first) {
          await chrome.storage.sync.set({ metricsFirstName: first });
          heartbeat(); // report to the live board immediately now that we have an identity
        }
      } catch (_) {}
    }

    // The M365 account control can render AFTER the content script loads, so a single
    // read often misses it (and nothing is sent without a first name). Wait for it,
    // re-read on changes, and net a periodic re-check (also catches an account switch
    // on a shared workstation).
    async function initFirstName() {
      const el = await waitForElement(NAME_SEL, 60000);
      await detectFirstName();
      if (el) {
        new MutationObserver(detectFirstName).observe(el, {
          childList: true, subtree: true, characterData: true,
          attributes: true, attributeFilter: ['aria-label'],
        });
      }
      setInterval(detectFirstName, 30000);
      document.addEventListener('visibilitychange', detectFirstName);
    }

    // — Presence sensor —
    function readAvailable() {
      const b = document.querySelector(PRESENCE_BUTTON_SEL);
      if (!b) return null;
      const label = (b.getAttribute('aria-label') || '').trim().toLowerCase();
      return label ? label.includes(AVAILABLE_LABEL) : null;
    }
    function reportPresence() {
      const a = readAvailable();
      if (a === null) return;
      // Call-end signal for the LIVE status: Dynamics auto-sets presence to "Do not
      // disturb" during a call and returns it to "Available" at hangup. So the moment
      // the operator is Available again, the call is over — end it (clears on_call, emits
      // the handle time). This makes on_call mean *actually on a call* and prevents a
      // stuck on_call if the session tab is left open in wrap-up. The session-tab detach
      // below stays a backstop for the rarer "went Away straight after the call" case.
      if (inCallLocal && a === true) endHandle(Date.now() - tAnswer);
      if (a === lastAvailable) return;
      lastAvailable = a;
      safeSendMessage({ type: 'METRIC_PRESENCE', available: a });
    }
    async function initPresence() {
      const btn = await waitForElement(PRESENCE_BUTTON_SEL, 60000);
      reportPresence();
      if (btn) {
        new MutationObserver(reportPresence).observe(btn, {
          attributes: true,
          attributeFilter: ['aria-label']
        });
      }
      setInterval(reportPresence, 30000);          // freshness net for missed mutations
      document.addEventListener('visibilitychange', reportPresence);
    }

    // — Handle-time helpers (Phase B) —
    function sessionTabIds() {
      return [...document.querySelectorAll(SESSION_TAB_SEL)].map((t) => t.id);
    }
    function stopHandle() {
      if (handleObserver) { handleObserver.disconnect(); handleObserver = null; }
      if (handleCap) { clearTimeout(handleCap); handleCap = null; }
      if (tabPoll) { clearInterval(tabPoll); tabPoll = null; }
      trackedTab = null;
    }
    function endHandle(handleMs) {
      // Honest degradation: only emit a real measured duration. A missed/capped end
      // contributes nothing to the average (never an infinite or bogus value).
      const emit = tAnswer && handleMs != null && handleMs >= 0 && handleMs <= HANDLE_CAP_MS;
      ct('call ended', { handleMs, emitted: !!emit });
      if (emit) safeSendMessage({ type: 'METRIC_CALL_ENDED', handleMs });
      resetCall();
    }
    function startHandle() {
      stopHandle();
      // The call opens a session tab (absent at ring); find the id that wasn't there at
      // ring, then end the handle when it detaches (conversation closed = end of wrap-up).
      // Duration = accept → close = handle time incl. wrap-up.
      const deadline = Date.now() + TAB_WAIT_MS;
      tabPoll = setInterval(() => {
        const newId = sessionTabIds().find((id) => !preTabIds.includes(id));
        if (newId) {
          clearInterval(tabPoll); tabPoll = null;
          trackedTab = document.getElementById(newId);
          ct('session tab opened', newId);
          if (trackedTab) {
            handleObserver = new MutationObserver(() => {
              if (trackedTab && !trackedTab.isConnected) endHandle(Date.now() - tAnswer);
            });
            // Scope to the tablist (the tab's parent) so the observer isn't firing on every
            // mutation of the whole page; the tab detaching from it triggers the callback.
            handleObserver.observe(trackedTab.parentElement || document.body, {
              childList: true, subtree: true,
            });
          }
        } else if (Date.now() > deadline) {
          clearInterval(tabPoll); tabPoll = null;   // no tab found; rely on the cap
          ct('no session tab within', TAB_WAIT_MS, 'ms — handle-end will rely on the 4h cap');
        }
      }, 500);
      handleCap = setTimeout(() => endHandle(null), HANDLE_CAP_MS);
    }

    // — Live status heartbeat + on-call signal —
    function heartbeat() { safeSendMessage({ type: 'METRIC_TICK' }); }
    function setInCall(v) {
      if (inCallLocal === v) return;          // only signal on change
      inCallLocal = v;
      safeSendMessage({ type: 'METRIC_CALL_STATE', inCall: v });
    }

    // — Call-lifecycle tracker —
    function resetCall() { setInCall(false); stopHandle(); ringKey = null; tRing = 0; tAnswer = 0; preTabIds = []; }
    // Ring notification gone (answered, declined, or timed out): re-arm ring dedupe so
    // the NEXT call is tracked even if it shares the same header text — WITHOUT tearing
    // down any in-progress handle tracking (Phase B keeps watching the session tab).
    function clearRing() { ringKey = null; tRing = 0; }
    function onAccept() {
      if (!tRing || tAnswer) return;
      tAnswer = Date.now();
      ct('answered', { ttaMs: tAnswer - tRing });
      safeSendMessage({ type: 'METRIC_CALL_ANSWERED', ttaMs: tAnswer - tRing });
      if (CALL_TRACKING_ENABLED) { setInCall(true); startHandle(); }
    }
    function onDecline() { ct('declined'); resetCall(); }
    function onRing(popup) {
      // Already timing an answered call — don't let a second ring clobber its
      // in-progress state (single-call tracker). Omnichannel holds the agent's capacity
      // during a call, so a concurrent voice call shouldn't route here anyway.
      if (tAnswer) return;
      const key = popup.querySelector('#popupNotificationHeaderText')?.textContent?.trim() || '__call__';
      if (ringKey === key) return;            // same call already tracked
      ringKey = key; tRing = Date.now(); tAnswer = 0;
      preTabIds = CALL_TRACKING_ENABLED ? sessionTabIds() : [];
      ct('ring', { preTabs: preTabIds.length });
      safeSendMessage({ type: 'METRIC_CALL_RECEIVED' });
      const accept = document.querySelector('#acceptButton');
      const decline = document.querySelector('#declineButton');
      if (accept) accept.addEventListener('click', onAccept, { capture: true, once: true });
      if (decline) decline.addEventListener('click', onDecline, { capture: true, once: true });
    }
    function checkCalls() {
      const popup = document.querySelector('#popupNotificationRoot');
      const isCall = popup && popup.querySelector('img[src*="phonecallicon"]');
      if (isCall) onRing(popup);
      else if (!popup && ringKey) clearRing();   // ring notification dismissed → re-arm for next call
    }

    metricsCheck = checkCalls;   // ride the existing document.body observer
    initFirstName();
    initPresence();
    checkCalls();

    heartbeat();                                   // announce presence immediately
    setInterval(heartbeat, HEARTBEAT_MS);          // keep the live board fresh
    document.addEventListener('visibilitychange', heartbeat);
  })();

  // ── Message Handling (from popup/background) ──────────────────────────
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Ignore messages meant for other targets
    if (message.target) return false;

    if (message.type === 'TEST_ALERTS') {
      startAllAlerts('Test Call — Dynamics Notifications', true);
      setTimeout(() => stopAllAlerts(), 5000);
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === 'GET_STATUS') {
      sendResponse({ detecting: alertsActive });
      return false;
    }

    if (message.type === 'STOP_CONTENT_ALERTS') {
      // Mark current call as dismissed by its header text so we don't re-trigger
      const popup = document.querySelector('#popupNotificationRoot');
      dismissedCallHeader = popup?.querySelector('#popupNotificationHeaderText')?.textContent?.trim() || '__dismissed__';
      stopAllAlerts(false); // don't notify background, it already knows
      return false;
    }

    if (message.type === 'LOCK_SET_PRESENCE') {
      handleLockSetPresence();
      return false;
    }

    if (message.type === 'LOCK_RESTORE_PRESENCE') {
      handleLockRestorePresence();
      return false;
    }

    return false;
  });

  // ── Escape key stops all alerts ──────────────────────────────────────
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && alertsActive) {
      const popup = document.querySelector('#popupNotificationRoot');
      dismissedCallHeader = popup?.querySelector('#popupNotificationHeaderText')?.textContent?.trim() || null;
      stopAllAlerts();
    }
  });

  // ── Cleanup on unload ─────────────────────────────────────────────────
  window.addEventListener('beforeunload', () => {
    stopAllAlerts();
    observer.disconnect();
  });

  console.log('[Dynamics Notifications] Content script loaded, watching for incoming calls...');
})();
