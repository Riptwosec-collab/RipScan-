const UI_VERSION = '2.2.0';
const THROTTLE_MS = 160;
const WATCHDOG_MS = 10_000;
const HARD_WATCHDOG_MS = 70_000;

const state = {
  lastProgressAt: 0,
  latest: null,
  timer: null,
  watchdog: null,
  busy: false,
  cancelledAt: 0,
  watchdogWarned: false,
  hardWatchdogWarned: false,
};

const $ = (selector, root = document) => root.querySelector(selector);

function formatDuration(milliseconds) {
  const seconds = Math.max(0, Math.ceil(Number(milliseconds || 0) / 1000));
  if (!seconds) return '—';
  if (seconds < 60) return `${seconds} วินาที`;
  return `${Math.floor(seconds / 60)} นาที ${seconds % 60} วินาที`;
}

function ensurePanel() {
  const settings = $('.settings-panel');
  if (!settings) return null;
  let panel = $('#ocrPerformanceProgress');
  if (!panel) {
    panel = document.createElement('section');
    panel.id = 'ocrPerformanceProgress';
    panel.className = 'ocr-performance-progress';
    panel.hidden = true;
    panel.setAttribute('aria-live', 'polite');
    panel.innerHTML = `
      <div class="ocr-progress-head">
        <div><strong id="ocrProgressTitle">กำลังเตรียม OCR</strong><small id="ocrProgressDetail">Web Worker · Region Queue</small></div>
        <button id="cancelProcessingButton" type="button" class="secondary danger-button">ยกเลิกการประมวลผล</button>
      </div>
      <div class="ocr-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span id="ocrProgressFill"></span></div>
      <div class="ocr-progress-stats">
        <span><small>หน้า</small><strong id="ocrProgressPage">—</strong></span>
        <span><small>Block</small><strong id="ocrProgressBlock">—</strong></span>
        <span><small>Text Region</small><strong id="ocrProgressText">0</strong></span>
        <span><small>ข้ามรูป</small><strong id="ocrProgressSkipped">0</strong></span>
        <span><small>Retry</small><strong id="ocrProgressRetry">0</strong></span>
        <span><small>ETA</small><strong id="ocrProgressEta">—</strong></span>
      </div>`;
    const status = $('#status', settings);
    settings.insertBefore(panel, status || null);
    $('#cancelProcessingButton', panel)?.addEventListener('click', cancelProcessing);
  }
  return panel;
}

function setBusy(busy) {
  state.busy = busy;
  const panel = ensurePanel();
  if (panel) panel.hidden = !busy;
  const runButton = $('#runButton');
  if (runButton) runButton.setAttribute('aria-busy', busy ? 'true' : 'false');
}

function render(detail) {
  const panel = ensurePanel();
  if (!panel || !detail) return;
  const percent = Math.max(0, Math.min(100, Math.round(Number(detail.progress || 0) * 100)));
  panel.hidden = false;
  const track = $('.ocr-progress-track', panel);
  track?.setAttribute('aria-valuenow', String(percent));
  const fill = $('#ocrProgressFill', panel);
  if (fill) fill.style.transform = `scaleX(${percent / 100})`;
  const title = $('#ocrProgressTitle', panel);
  if (title) title.textContent = detail.label || detail.status || 'กำลังประมวลผล';
  const detailText = $('#ocrProgressDetail', panel);
  if (detailText) detailText.textContent = `${detail.stage || 'processing'} · ${percent}%`;
  const values = {
    '#ocrProgressPage': detail.page ? String(detail.page) : '—',
    '#ocrProgressBlock': detail.totalBlocks ? `${detail.block || 0}/${detail.totalBlocks}` : '—',
    '#ocrProgressText': String(detail.textRegions || 0),
    '#ocrProgressSkipped': String(detail.skippedRegions || 0),
    '#ocrProgressRetry': String(detail.retryRegions || 0),
    '#ocrProgressEta': formatDuration(detail.etaMs),
  };
  for (const [selector, value] of Object.entries(values)) {
    const element = $(selector, panel);
    if (element) element.textContent = value;
  }
  setBusy(detail.status !== 'complete' && detail.status !== 'cancelled');
}

function scheduleRender(detail) {
  state.latest = detail;
  state.lastProgressAt = performance.now();
  state.watchdogWarned = false;
  state.hardWatchdogWarned = false;
  if (state.timer) return;
  state.timer = setTimeout(() => {
    state.timer = null;
    render(state.latest);
  }, THROTTLE_MS);
}

async function cancelProcessing() {
  const button = $('#cancelProcessingButton');
  if (button) {
    button.disabled = true;
    button.textContent = 'กำลังยกเลิก…';
  }
  state.cancelledAt = performance.now();
  try {
    await Promise.race([
      Promise.resolve(window.RipScanBookOCR?.cancel?.()),
      new Promise(resolve => setTimeout(resolve, 1_900)),
    ]);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = 'ยกเลิกการประมวลผล';
    }
    const statusText = $('#statusText');
    if (statusText) statusText.textContent = 'ยกเลิกแล้ว · เก็บผลที่ประมวลผลสำเร็จก่อนยกเลิก';
    setBusy(false);
  }
}

function startWatchdog() {
  if (state.watchdog) return;
  state.watchdog = setInterval(() => {
    if (!state.busy || !state.lastProgressAt) return;
    const idle = performance.now() - state.lastProgressAt;
    if (idle < WATCHDOG_MS) return;
    const title = $('#ocrProgressTitle');
    const detail = $('#ocrProgressDetail');
    if (!state.watchdogWarned) {
      state.watchdogWarned = true;
      if (title) title.textContent = 'กำลังรอการตอบกลับจาก OCR Worker';
      if (detail) detail.textContent = 'ระบบยังไม่หยุดงาน · กำลังตรวจสถานะ Worker';
      window.dispatchEvent(new CustomEvent('ripscan:ocr-watchdog', { detail: { idleMs: idle, level: 'warning' } }));
    }
    if (idle >= HARD_WATCHDOG_MS && !state.hardWatchdogWarned) {
      state.hardWatchdogWarned = true;
      if (title) title.textContent = 'Worker ใช้เวลานานผิดปกติ';
      if (detail) detail.textContent = 'ระบบ Timeout และเริ่ม Worker ใหม่ได้สูงสุด 1 ครั้ง';
      window.dispatchEvent(new CustomEvent('ripscan:ocr-watchdog', { detail: { idleMs: idle, level: 'timeout' } }));
    }
  }, 2_000);
}

window.addEventListener('ripscan:ocr-progress', event => scheduleRender(event.detail || {}));
window.addEventListener('ripscan:ocr-cancelled', () => {
  scheduleRender({ status: 'cancelled', stage: 'cancelled', progress: 0, label: 'ยกเลิกการประมวลผลแล้ว' });
  setBusy(false);
});
window.addEventListener('ripscan:job-start', event => {
  if (!['legacy-ocr', 'ocr'].includes(String(event.detail?.type || ''))) return;
  state.lastProgressAt = performance.now();
  state.watchdogWarned = false;
  state.hardWatchdogWarned = false;
  setBusy(true);
});
window.addEventListener('ripscan:job-end', event => {
  if (String(event.detail?.type || '') !== 'legacy-ocr') return;
  setBusy(false);
});
window.addEventListener('beforeunload', () => {
  clearInterval(state.watchdog);
  clearTimeout(state.timer);
});

document.addEventListener('click', event => {
  if (event.target.closest('#clearScanPagesButton, #clearButton')) window.RipScanBookOCR?.cancel?.();
});

ensurePanel();
startWatchdog();
document.documentElement.dataset.ocrPerformanceVersion = UI_VERSION;
