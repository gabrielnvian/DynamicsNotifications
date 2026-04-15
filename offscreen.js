// Dynamics Notifications — Offscreen Document for Audio Playback
// Plays the Teams Remix ringtone MP3 on loop with volume boost

let audioCtx = null;
let gainNode = null;
let compressorNode = null;
let boostNode = null;
let sourceNode = null;
let audioBuffers = {}; // cached decoded audio keyed by filename
let selectedDeviceId = '';
let selectedRingtone = 'agent.mp3';

// Pre-fetch and decode a ringtone so playback is instant
async function loadRingtone(filename) {
  if (audioBuffers[filename]) return audioBuffers[filename];
  try {
    const response = await fetch(chrome.runtime.getURL(filename));
    const arrayBuffer = await response.arrayBuffer();
    const tempCtx = new AudioContext();
    const buffer = await tempCtx.decodeAudioData(arrayBuffer);
    await tempCtx.close();
    audioBuffers[filename] = buffer;
    return buffer;
  } catch (e) {
    console.warn('[Dynamics Notifications] Failed to load ringtone:', filename, e);
    return null;
  }
}

// Pre-load all ringtones
loadRingtone('teams.mp3');
loadRingtone('discord.mp3');
loadRingtone('agent.mp3');
loadRingtone('skype.mp3');

async function startRingtone(volume, deviceId, ringtone) {
  stopRingtone();

  try {
    const filename = ringtone || selectedRingtone;
    const audioBuffer = await loadRingtone(filename);
    if (!audioBuffer) return;

    // Create AudioContext and route to selected output device
    audioCtx = new AudioContext();
    const sinkId = deviceId || selectedDeviceId;
    if (sinkId && audioCtx.setSinkId) {
      try { await audioCtx.setSinkId(sinkId); } catch (e) {
        console.warn('[Dynamics Notifications] Could not set audio output device:', e);
      }
    }

    // Create buffer source (looping)
    sourceNode = audioCtx.createBufferSource();
    sourceNode.buffer = audioBuffer;
    sourceNode.loop = true;

    // Fixed boost — drives the signal hard (10x) for maximum loudness
    boostNode = audioCtx.createGain();
    boostNode.gain.setValueAtTime(10.0, audioCtx.currentTime);

    // Compressor to maximize perceived loudness without harsh clipping
    compressorNode = audioCtx.createDynamicsCompressor();
    compressorNode.threshold.setValueAtTime(-10, audioCtx.currentTime);
    compressorNode.knee.setValueAtTime(3, audioCtx.currentTime);
    compressorNode.ratio.setValueAtTime(4, audioCtx.currentTime);
    compressorNode.attack.setValueAtTime(0.003, audioCtx.currentTime);
    compressorNode.release.setValueAtTime(0.1, audioCtx.currentTime);

    // Volume gain — respects the user's chosen volume
    gainNode = audioCtx.createGain();
    gainNode.gain.setValueAtTime(volume, audioCtx.currentTime);

    // Chain: source → boost → compressor → volume → output
    sourceNode.connect(boostNode);
    boostNode.connect(compressorNode);
    compressorNode.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }

    sourceNode.start(0);
  } catch (e) {
    console.warn('[Dynamics Notifications] Offscreen audio failed:', e);
  }
}

function stopRingtone() {
  if (sourceNode) {
    try { sourceNode.stop(); } catch (_) {}
    try { sourceNode.disconnect(); } catch (_) {}
    sourceNode = null;
  }
  if (boostNode) { try { boostNode.disconnect(); } catch (_) {} boostNode = null; }
  if (compressorNode) { try { compressorNode.disconnect(); } catch (_) {} compressorNode = null; }
  if (gainNode) { try { gainNode.disconnect(); } catch (_) {} gainNode = null; }
  if (audioCtx) { try { audioCtx.close(); } catch (_) {} audioCtx = null; }
}

function setVolume(volume) {
  if (gainNode && audioCtx) {
    gainNode.gain.cancelScheduledValues(audioCtx.currentTime);
    gainNode.gain.setValueAtTime(volume, audioCtx.currentTime);
  }
}

async function enumerateOutputDevices() {
  try {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
    } catch (_) {}

    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter(d => d.kind === 'audiooutput')
      .map(d => ({ deviceId: d.deviceId, label: d.label || `Speaker ${d.deviceId.slice(0, 8)}` }));
  } catch (e) {
    console.warn('[Dynamics Notifications] Could not enumerate devices:', e);
    return [];
  }
}

// Listen for messages from background.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen') return;

  switch (message.type) {
    case 'START_RINGTONE':
      startRingtone(message.volume ?? 1.0, message.deviceId, message.ringtone);
      break;
    case 'STOP_RINGTONE':
      stopRingtone();
      break;
    case 'SET_VOLUME':
      setVolume(message.volume ?? 1.0);
      break;
    case 'SET_DEVICE':
      selectedDeviceId = message.deviceId || '';
      // Apply to currently playing AudioContext if possible
      if (audioCtx && audioCtx.setSinkId && selectedDeviceId) {
        audioCtx.setSinkId(selectedDeviceId).catch(() => {});
      }
      break;
    case 'SET_RINGTONE':
      selectedRingtone = message.ringtone || 'agent.mp3';
      break;
    case 'GET_DEVICES':
      enumerateOutputDevices().then(devices => sendResponse({ devices }));
      return true; // async response
  }
});
