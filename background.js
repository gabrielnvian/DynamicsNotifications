// Dynamics Notifications — Service Worker (background.js)
// Handles: offscreen audio, desktop notifications, alert window, badge, tab focus

import * as metrics from './metrics.js';

let callingTabId = null;
let notificationInterval = null;
let notificationCounter = 0;
let callActive = false; // gate flag to prevent race conditions

// Allow content scripts to read/write chrome.storage.session (for savedPresence on lock/unlock)
chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' }).catch(() => {});

// ── Startup: pre-create the offscreen doc so the ringtone can play instantly ──
chrome.runtime.onInstalled.addListener(() => {
  initOffscreen();
  initMetrics();
});
chrome.runtime.onStartup.addListener(() => {
  initOffscreen();
  initMetrics();
  metrics.flush();
});

async function initOffscreen() {
  // Pre-create the offscreen document so the ringtone plays instantly on the first
  // call. Do NOT enumerate audio devices here — that calls getUserMedia and would
  // fire a microphone prompt at install. Device labels load lazily only when the
  // operator opens the popup's audio-output picker (see popup.js GET_DEVICES).
  await ensureOffscreen();
}

// ── Offscreen Document Management ───────────────────────────────────────
let creatingOffscreen = null;

async function ensureOffscreen() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });
  if (existingContexts.length > 0) return;

  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }

  creatingOffscreen = chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['AUDIO_PLAYBACK', 'USER_MEDIA'],
    justification: 'Playing ringtone and enumerating audio devices for Dynamics 365 call alerts'
  });
  await creatingOffscreen;
  creatingOffscreen = null;
}

async function startRingtone(volume, deviceId, ringtone) {
  await ensureOffscreen();
  if (!callActive) return;
  chrome.runtime.sendMessage({
    target: 'offscreen',
    type: 'START_RINGTONE',
    volume: volume,
    deviceId: deviceId || '',
    ringtone: ringtone || 'agent.mp3'
  });
}

function stopRingtone() {
  chrome.runtime.sendMessage({
    target: 'offscreen',
    type: 'STOP_RINGTONE'
  }).catch(() => {});
}

// ── Bring Dynamics Tab to Front ──────────────────────────────────────────
function bringDynamicsToFront() {
  if (!callingTabId) return;
  chrome.tabs.get(callingTabId, (tab) => {
    if (chrome.runtime.lastError || !tab) return;
    // Focus the Chrome window and activate the Dynamics tab
    chrome.windows.update(tab.windowId, { focused: true }, () => {
      chrome.tabs.update(callingTabId, { active: true });
    });
  });
}

// ── Repeated Notifications ──────────────────────────────────────────────
function startRepeatedNotifications(callerInfo) {
  if (!callActive) return; // call already ended
  notificationCounter = 0;
  fireNotification(callerInfo);

  notificationInterval = setInterval(() => {
    if (!callActive) {
      stopRepeatedNotifications();
      return;
    }
    notificationCounter++;
    fireNotification(callerInfo);
  }, 6000);
}

function fireNotification(callerInfo) {
  const notifId = `dynamics-call-${notificationCounter}`;
  chrome.notifications.create(notifId, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: '☎️ Incoming Call!',
    message: callerInfo || 'Incoming call in Dynamics 365',
    priority: 2,
    requireInteraction: true
  });

  // Clear previous notification after a short delay so it doesn't vanish instantly
  const prevId = `dynamics-call-${notificationCounter - 1}`;
  setTimeout(() => chrome.notifications.clear(prevId), 500);
}

function stopRepeatedNotifications() {
  if (notificationInterval) {
    clearInterval(notificationInterval);
    notificationInterval = null;
  }
  // Clear ALL dynamics notifications (handles orphaned ones after service worker restart)
  chrome.notifications.getAll((notifications) => {
    for (const id of Object.keys(notifications)) {
      if (id.startsWith('dynamics-call-')) {
        chrome.notifications.clear(id);
      }
    }
  });
  notificationCounter = 0;
}

// ── Stop Everything ─────────────────────────────────────────────────────
function stopAll() {
  const wasActive = callActive;
  callActive = false;

  // Always stop these — even if callActive was already false (stale state)
  stopRingtone();
  stopRepeatedNotifications();
  chrome.action.setBadgeText({ text: '' });

  // Tell content script to stop its visual alerts
  if (callingTabId) {
    chrome.tabs.sendMessage(callingTabId, { type: 'STOP_CONTENT_ALERTS' }).catch(() => {});
  } else if (!wasActive) {
    // If callingTabId is null (already cleared), try to recover from session storage
    chrome.storage.session.get('callingTabId', (data) => {
      if (data.callingTabId) {
        chrome.tabs.sendMessage(data.callingTabId, { type: 'STOP_CONTENT_ALERTS' }).catch(() => {});
      }
    });
  }

  callingTabId = null;
  chrome.storage.session.remove('callingTabId');
}

// ── Focus Dynamics Tab ──────────────────────────────────────────────────
function focusDynamicsTab() {
  const doFocus = (tabId) => {
    if (!tabId) return;
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError || !tab) return;
      chrome.windows.update(tab.windowId, { focused: true, drawAttention: true }, () => {
        chrome.tabs.update(tabId, { active: true });
      });
    });
  };

  if (callingTabId) {
    doFocus(callingTabId);
  } else {
    chrome.storage.session.get('callingTabId', (data) => {
      doFocus(data.callingTabId);
    });
  }
}

// ── Message Handling ────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target === 'offscreen') return;

  if (message.type && message.type.startsWith('METRIC_')) {
    handleMetricMessage(message);
    return false;
  }

  if (message.type === 'CALL_DETECTED') {
    callActive = true;
    callingTabId = sender.tab?.id ?? null;
    chrome.storage.session.set({ callingTabId });

    // Bring the Dynamics tab to the foreground immediately
    bringDynamicsToFront();

    chrome.storage.sync.get({
      enabled: true,
      volume: 1.0,
      alertSound: true,
      alertNotification: true,
      audioDeviceId: '',
      ringtone: 'agent.mp3'
    }, (settings) => {
      if (!settings.enabled || !callActive) return;

      if (settings.alertNotification) {
        startRepeatedNotifications(message.callerInfo);
      }

      if (settings.alertSound) {
        startRingtone(settings.volume, settings.audioDeviceId, settings.ringtone);
      }
    });

    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#0062A5' });
  }

  if (message.type === 'TEST_ALERTS') {
    // Test fires alerts directly from background with a 5-second auto-stop
    callActive = true;
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#0062A5' });

    chrome.storage.sync.get({
      enabled: true,
      volume: 1.0,
      alertSound: true,
      alertNotification: true,
      audioDeviceId: '',
      ringtone: 'agent.mp3'
    }, (settings) => {
      if (!callActive) return;

      if (settings.alertNotification) {
        startRepeatedNotifications(message.callerInfo || 'Test Call');
      }
      if (settings.alertSound) {
        startRingtone(settings.volume, settings.audioDeviceId, settings.ringtone);
      }
    });

    // Auto-stop after 5 seconds
    setTimeout(() => stopAll(), 5000);
  }

  if (message.type === 'CALL_ENDED') {
    stopAll();
  }

  if (message.type === 'GET_DEVICES') {
    ensureOffscreen().then(() => {
      // Small delay to let offscreen script initialize
      setTimeout(() => {
        chrome.runtime.sendMessage({
          target: 'offscreen',
          type: 'GET_DEVICES'
        }, (response) => {
          sendResponse(response);
        });
      }, 100);
    });
    return true; // async
  }
});

// Notification click → stop everything and focus Dynamics tab
chrome.notifications.onClicked.addListener((notificationId) => {
  if (!notificationId.startsWith('dynamics-call-')) return;
  focusDynamicsTab();
  stopAll();
});

// Notification X button (close/dismiss) → also stop everything
chrome.notifications.onClosed.addListener((notificationId, byUser) => {
  if (!notificationId.startsWith('dynamics-call-')) return;
  if (byUser) stopAll();
});

// ── Lock/unlock presence handling ───────────────────────────────────────
let wasLocked = false;
let lockCloseTabsTimeout = null;
const LOCK_CLOSE_TAB_DELAY_MS = 10_000;

function broadcastToDynamicsTabs(message) {
  chrome.tabs.query({ url: '*://*.dynamics.com/*' }, (tabs) => {
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, message).catch(() => {});
    }
  });
}

function closeAllDynamicsTabs() {
  chrome.tabs.query({ url: '*://*.dynamics.com/*' }, (tabs) => {
    for (const tab of tabs) {
      chrome.tabs.remove(tab.id).catch(() => {});
    }
  });
}

function cancelScheduledTabClose() {
  if (lockCloseTabsTimeout !== null) {
    clearTimeout(lockCloseTabsTimeout);
    lockCloseTabsTimeout = null;
  }
}

chrome.idle.onStateChanged.addListener((state) => {
  metrics.withLock(() => updateMetricsInput({ idle: state })).then(() => pushPresence());

  if (state === 'locked') {
    wasLocked = true;
    stopAll();
    broadcastToDynamicsTabs({ type: 'LOCK_SET_PRESENCE' });

    chrome.storage.sync.get({ lockCloseTabs: true }, ({ lockCloseTabs }) => {
      if (!lockCloseTabs) return;
      cancelScheduledTabClose();
      lockCloseTabsTimeout = setTimeout(() => {
        lockCloseTabsTimeout = null;
        closeAllDynamicsTabs();
      }, LOCK_CLOSE_TAB_DELAY_MS);
    });
  } else if (state === 'active' && wasLocked) {
    wasLocked = false;
    cancelScheduledTabClose();
    broadcastToDynamicsTabs({ type: 'LOCK_RESTORE_PRESENCE' });
  }
});

// Live volume updates
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  if (changes.volume) {
    chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'SET_VOLUME',
      volume: changes.volume.newValue
    }).catch(() => {});
  }
  if (changes.audioDeviceId) {
    chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'SET_DEVICE',
      deviceId: changes.audioDeviceId.newValue
    }).catch(() => {});
  }
  if (changes.ringtone) {
    chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'SET_RINGTONE',
      ringtone: changes.ringtone.newValue
    }).catch(() => {});
  }
});

// ── Team Metrics wiring (mandatory; all logic in metrics.js) ──────────────
function initMetrics() {
  chrome.alarms.create('metricsFlush', { periodInMinutes: 1 });
  metrics.ensureInstallId().catch(() => {});
  // chrome.idle.onStateChanged doesn't fire an initial event, so a 'locked'/'idle'
  // value persisted from last session would stick after a reboot and mis-report an
  // active operator as "away" with zero available time. Seed the real state now.
  chrome.idle.setDetectionInterval(60);
  chrome.idle.queryState(60, (state) => {
    metrics.withLock(() => updateMetricsInput({ idle: state }));
  });
}

function hasDynamicsTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ url: '*://*.dynamics.com/*' }, (tabs) => resolve(tabs.length > 0));
  });
}

async function updateMetricsInput(patch, now = Date.now()) {
  const stored = await chrome.storage.local.get('metrics.inputs');
  const merged = { ...(stored['metrics.inputs'] || {}), ...patch };
  await chrome.storage.local.set({ 'metrics.inputs': merged });
  await recomputeAvailability(now);
}

async function recomputeAvailability(now = Date.now()) {
  const stored = await chrome.storage.local.get('metrics.inputs');
  const inputs = stored['metrics.inputs'] || {};
  const hasTab = await hasDynamicsTab();
  // Same rule as the live status: idle-but-unlocked still counts as available for
  // calls; only a locked screen (stepped away) stops the available-time clock.
  const available =
    hasTab && inputs.idle !== 'locked' && inputs.presence === 'available';
  await metrics.setEffectiveAvailable(available, now);
}

// ── Live presence board — best-effort heartbeat (POST /v1/presence) ────────
// Fire-and-forget: liveness is disposable, so no durable queue. We only POST while
// a Dynamics tab is open (content-script ticks drive the cadence), so a closed tab
// simply stops beating and the server reads the operator as offline via staleness.
async function pushPresence(now = Date.now()) {
  const stored = await chrome.storage.local.get('metrics.inputs');
  const inputs = stored['metrics.inputs'] || {};
  const hasTab = await hasDynamicsTab();
  if (!hasTab) return;

  // Idle (no keyboard/mouse for a while) does NOT make an operator unavailable — an
  // agent waiting for calls isn't constantly typing. Only a LOCKED screen (they
  // actually stepped away) counts as away.
  let status;
  if (inputs.idle === 'locked') status = 'away';
  else if (inputs.inCall) status = 'on_call';
  else if (inputs.presence === 'available') status = 'available';
  else status = 'away';

  await metrics.sendPresence(status);
}

async function handleMetricMessage(message) {
  const now = Date.now();
  switch (message.type) {
    case 'METRIC_TICK':
      await pushPresence(now);
      break;
    case 'METRIC_PRESENCE':
      await metrics.withLock(() =>
        updateMetricsInput({ presence: message.available ? 'available' : 'other' }, now),
      );
      await pushPresence(now);
      break;
    case 'METRIC_CALL_STATE':
      await metrics.withLock(() => updateMetricsInput({ inCall: !!message.inCall }, now));
      await pushPresence(now);
      break;
    case 'METRIC_CALL_RECEIVED':
      await metrics.withLock(() => metrics.recordCallReceived(now));
      break;
    case 'METRIC_CALL_ANSWERED':
      await metrics.withLock(() => metrics.recordCallAnswered(message.ttaMs, now));
      break;
    case 'METRIC_CALL_ENDED':
      await metrics.withLock(() => metrics.recordCallEnded(message.handleMs, now));
      metrics.flush();
      break;
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== 'metricsFlush') return;
  (async () => {
    await metrics.withLock(() => metrics.tickIfAvailable());
    await metrics.sweepOld();
    await metrics.flush();
    // Throttle-proof presence keepalive: the content-script 15s heartbeat slows to
    // ~1/min when its Dynamics tab is backgrounded, but this alarm fires regardless,
    // so a working operator on another tab still reads "available", not offline.
    await pushPresence();
  })();
});

chrome.tabs.onRemoved.addListener(() => {
  metrics.withLock(() => recomputeAvailability());
});

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status !== 'complete') return;
  metrics.withLock(() => recomputeAvailability());
});
