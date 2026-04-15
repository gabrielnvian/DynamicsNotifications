// Dynamics Notifications — Popup Script (popup.js)

const SETTINGS_KEYS = [
  'enabled', 'volume', 'ringtone', 'alertSound', 'alertNotification', 'alertWindow',
  'alertVisualOverlay', 'alertFullscreenFlash', 'audioDeviceId',
  'lockAutoPresence'
];

const DEFAULTS = {
  enabled: true,
  volume: 1.0,
  ringtone: 'agent.mp3',
  alertSound: true,
  alertNotification: true,
  alertWindow: true,
  alertVisualOverlay: true,
  alertFullscreenFlash: true,
  audioDeviceId: '',
  lockAutoPresence: true
};

// ── Load settings into UI ───────────────────────────────────────────────
chrome.storage.sync.get(DEFAULTS, (settings) => {
  document.getElementById('enabled').checked = settings.enabled;
  const sliderVal = Math.round(settings.volume * 100);
  document.getElementById('volume').value = sliderVal;
  document.getElementById('volumeValue').textContent = sliderVal + '%';
  document.getElementById('alertSound').checked = settings.alertSound;
  document.getElementById('alertNotification').checked = settings.alertNotification;
  document.getElementById('alertWindow').checked = settings.alertWindow;
  document.getElementById('alertVisualOverlay').checked = settings.alertVisualOverlay;
  document.getElementById('alertFullscreenFlash').checked = settings.alertFullscreenFlash;
  document.getElementById('ringtone').value = settings.ringtone;
  document.getElementById('lockAutoPresence').checked = settings.lockAutoPresence;

  loadAudioDevices(settings.audioDeviceId);
});

// ── Audio Device Enumeration (via offscreen document) ───────────────────
function loadAudioDevices(selectedId) {
  // Retry a few times — offscreen doc may still be loading its script
  let attempts = 0;
  function tryLoad() {
    attempts++;
    chrome.runtime.sendMessage({ type: 'GET_DEVICES' }, (response) => {
      if (chrome.runtime.lastError || !response || !response.devices) {
        if (attempts < 3) {
          setTimeout(tryLoad, 500);
        }
        return;
      }

      const select = document.getElementById('audioDevice');
      while (select.options.length > 1) select.remove(1);

      for (const device of response.devices) {
        const option = document.createElement('option');
        option.value = device.deviceId;
        option.textContent = device.label;
        if (device.deviceId === selectedId) option.selected = true;
        select.appendChild(option);
      }
    });
  }
  tryLoad();
}

// ── Save on change ──────────────────────────────────────────────────────
for (const key of SETTINGS_KEYS) {
  let elId = key;
  if (key === 'audioDeviceId') elId = 'audioDevice';
  const el = document.getElementById(elId);
  if (!el) continue;

  el.addEventListener('input', () => {
    if (key === 'volume') {
      const val = parseInt(el.value, 10);
      document.getElementById('volumeValue').textContent = val + '%';
      chrome.storage.sync.set({ volume: val / 100 });
    } else if (key === 'audioDeviceId') {
      chrome.storage.sync.set({ audioDeviceId: el.value });
    } else if (key === 'ringtone') {
      chrome.storage.sync.set({ [key]: el.value });
    } else {
      chrome.storage.sync.set({ [key]: el.checked });
    }
  });
}

// ── Status indicator ────────────────────────────────────────────────────
function updateStatus(detecting) {
  const dot = document.getElementById('statusDot');
  const text = document.getElementById('statusText');
  if (detecting) {
    dot.classList.add('active');
    text.textContent = 'INCOMING CALL!';
    text.style.color = '#f44336';
    text.style.fontWeight = '600';
  } else {
    dot.classList.remove('active');
    text.textContent = 'Idle';
    text.style.color = '#666';
    text.style.fontWeight = 'normal';
  }
}

// ── Test button — sends directly to background ─────────────────────────
document.getElementById('testBtn').addEventListener('click', () => {
  const btn = document.getElementById('testBtn');
  btn.textContent = 'Testing...';
  btn.disabled = true;
  updateStatus(true);

  chrome.runtime.sendMessage({ type: 'TEST_ALERTS', callerInfo: 'Test Call — Dynamics Notifications' });

  setTimeout(() => {
    btn.textContent = 'Test Alerts';
    btn.disabled = false;
    updateStatus(false);
  }, 5000);
});
