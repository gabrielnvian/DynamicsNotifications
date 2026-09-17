// Dynamics Notifications — Remote kill switch (kill-switch.js)
// The admin disables every install by publishing a TXT record on sth-check.viancorp.net.
// The verdict is cached in chrome.storage.local under `adminDisabled`, which
// background.js, content.js and popup.js read (the latter two by literal key, since
// they aren't ES modules and can't import this file).

const DNS_URL = 'https://dns.google/resolve?name=sth-check.viancorp.net&type=TXT';

const ALARM_NAME = 'killSwitchCheck';

// Requested cadence for the routine check.
const CHECK_PERIOD_MINUTES = 30;

// Delay before confirming a freshly seen record, or retrying a failed lookup. A single
// sighting never disables: a transient/mistaken record must survive this second look.
const RECHECK_DELAY_MINUTES = 3;

// A hung DoH request must not keep the service worker alive indefinitely; 10s is far
// above a healthy dns.google round-trip.
const LOOKUP_TIMEOUT_MS = 10_000;

// DNS wire values used by the Google DoH JSON API
const DNS_STATUS_NOERROR = 0;
const DNS_STATUS_NXDOMAIN = 3;
const DNS_TYPE_TXT = 16;

// fetch() rejects with TypeError on network failure and a TimeoutError DOMException when
// AbortSignal.timeout fires; response.json() rejects with SyntaxError on a bad body.
// These are the expected "check failed" outcomes — anything else is a bug and propagates.
function isExpectedLookupError(error) {
  return error instanceof TypeError || error instanceof SyntaxError || error?.name === 'TimeoutError';
}

// Resolves to 'present' | 'clear' | 'failed'
async function lookupRecord() {
  let body;
  try {
    const response = await fetch(DNS_URL, { cache: 'no-store', signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) });
    if (response.status !== 200) return 'failed';

    body = await response.json();
  } catch (error) {
    if (isExpectedLookupError(error)) return 'failed';
    throw error;
  }

  if (body?.Status === DNS_STATUS_NXDOMAIN) return 'clear';
  if (body?.Status !== DNS_STATUS_NOERROR) return 'failed';

  const answers = Array.isArray(body.Answer) ? body.Answer : [];

  return answers.some((answer) => answer?.type === DNS_TYPE_TXT) ? 'present' : 'clear';
}

// Pulls the next check forward to RECHECK_DELAY_MINUTES while keeping the 30-min period,
// so the routine cadence resumes on its own after the retry fires.
function scheduleRecheck() {
  chrome.alarms.create(ALARM_NAME, { delayInMinutes: RECHECK_DELAY_MINUTES, periodInMinutes: CHECK_PERIOD_MINUTES });
}

async function runCheck() {
  const result = await lookupRecord();

  if (result === 'failed') {
    // Cached state and any pending confirmation are left untouched
    scheduleRecheck();
    return;
  }

  if (result === 'clear') {
    await chrome.storage.local.set({ adminDisabled: false, killSwitchConfirmPending: false });
    return;
  }

  // Pending lives in storage because the service worker is usually dead by the re-check
  const { killSwitchConfirmPending } = await chrome.storage.local.get({ killSwitchConfirmPending: false });

  if (killSwitchConfirmPending) {
    await chrome.storage.local.set({ adminDisabled: true, killSwitchConfirmPending: false });
    return;
  }

  await chrome.storage.local.set({ killSwitchConfirmPending: true });
  scheduleRecheck();
}

// Called on install/startup: alarms aren't guaranteed to survive a browser restart
export function startKillSwitch() {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: CHECK_PERIOD_MINUTES });
  runCheck();
}

export function handleKillSwitchAlarm(alarm) {
  if (alarm.name === ALARM_NAME) runCheck();
}
