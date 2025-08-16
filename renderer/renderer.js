const $ = (sel) => document.querySelector(sel);

function setStatus({ active, nextAt }) {
  const badge = $('#statusBadge');
  badge.textContent = active ? 'Active' : 'Paused';
  badge.classList.toggle('active', !!active);
  badge.classList.toggle('paused', !active);
  $('#nextAt').textContent = nextAt ? `Next move: ${new Date(nextAt).toLocaleString()}` : '';
}

async function loadSettings() {
  const s = await window.api.getSettings();
  $('#intervalMinutes').value = s.intervalMinutes;
  $('#intervalVariance').value = s.intervalVariance;
  $('#skipChance').value = s.skipChance;
  $('#radiusMin').value = s.radiusMin;
  $('#radiusMax').value = s.radiusMax;
  $('#moveDurationMsMin').value = s.moveDurationMsMin;
  $('#moveDurationMsMax').value = s.moveDurationMsMax;
  $('#jitterPx').value = s.jitterPx;
  $('#startAtLogin').checked = !!s.startAtLogin;
  const status = await window.api.getStatus();
  setStatus(status);
}

async function saveSettings() {
  const changes = {
    intervalMinutes: Number($('#intervalMinutes').value),
    intervalVariance: Number($('#intervalVariance').value),
    skipChance: Number($('#skipChance').value),
    radiusMin: Number($('#radiusMin').value),
    radiusMax: Number($('#radiusMax').value),
    moveDurationMsMin: Number($('#moveDurationMsMin').value),
    moveDurationMsMax: Number($('#moveDurationMsMax').value),
    jitterPx: Number($('#jitterPx').value),
    startAtLogin: $('#startAtLogin').checked
  };
  await window.api.saveSettings(changes);
  await loadSettings();
}

async function start() { setStatus(await window.api.start()); }
async function stop()  { setStatus(await window.api.stop()); }

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  $('#saveBtn').addEventListener('click', saveSettings);
  $('#startBtn').addEventListener('click', start);
  $('#stopBtn').addEventListener('click', stop);
  window.api.onStatus(setStatus);
});
