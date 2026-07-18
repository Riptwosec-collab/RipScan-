const UI_VERSION = '2.3.0';
const THROTTLE_MS = 160;
const WATCHDOG_MS = 10_000;
const HARD_WATCHDOG_MS = 70_000;
const WORKER_START_TIMEOUT_MS = 45_000;
const RECOGNIZE_TIMEOUT_MS = 60_000;

const state = {
  lastProgressAt: 0,
  latest: null,
  timer: null,
  watchdog: null,
  busy: false,
  cancelledAt: 0,
  watchdogWarned: false,
  hardWatchdogWarned: false,
  hardTimeoutHandling: false,
  workerStartRetries: 0,
};

const $ = (selector, root = document) => root.querySelector(selector);

function formatDuration(milliseconds) {
  const seconds = Math.max(0, Math.ceil(Number(milliseconds || 0) / 1000));
  if (!seconds) return '—';
  if (seconds < 60) return `${seconds} วินาที`;
  return `${Math.floor(seconds / 60)} นาที ${seconds % 60} วินาที`;
}

function timeoutError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function withDeadline(factory, milliseconds, code, onTimeout) {
  let timer = null;
  let timedOut = false;
  const operation = Promise.resolve().then(factory);
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      onTimeout?.();
      reject(timeoutError(code));
    }, Math.max(1, milliseconds));
  });
  operation.then(value => {
    if (timedOut) Promise.resolve(value?.terminate?.()).catch(() => undefined);
  }, () => undefined);
  return Promise.race([operation, timeout]).finally(() => clearTimeout(timer));
}

function emitProgress(detail = {}) {
  window.dispatchEvent(new CustomEvent('ripscan:ocr-progress', {
    detail: { timestamp: performance.now(), ...detail },
  }));
}

function workerLabel(message = {}) {
  const status = String(message.status || '').toLowerCase();
  const percent = Math.max(0, Math.min(100, Math.round(Number(message.progress || 0) * 100)));
  if (status.includes('loading tesseract core')) return 'กำลังโหลด OCR Core';
  if (status.includes('loading language')) return 'กำลังโหลดภาษา OCR';
  if (status.includes('initializing')) return 'กำลังเริ่ม OCR Worker';
  if (status.includes('recognizing text')) return `กำลังอ่านข้อความ · ${percent}%`;
  return status || 'OCR Worker ยังทำงานอยู่';
}

function wrapWorker(worker) {
  if (!worker || worker.__ripscanStallGuard === true) return worker;
  Object.defineProperty(worker, '__ripscanStallGuard', { value: true });
  const originalRecognize = worker.recognize?.bind(worker);
  if (originalRecognize) {
    worker.recognize = (...arguments_) => withDeadline(
      () => originalRecognize(...arguments_),
      RECOGNIZE_TIMEOUT_MS,
      'OCR_RECOGNIZE_TIMEOUT',
      () => {
        emitProgress({
          status: 'recognize_timeout', stage: 'timeout', progress: Number(state.latest?.progress || 0),
          label: 'อ่านข้อความเกิน 60 วินาที · กำลังหยุด Worker', issueType: 'OCR_RECOGNIZE_TIMEOUT',
        });
        Promise.resolve(worker.terminate?.()).catch(() => undefined);
      },
    );
  }
  return worker;
}

function installTesseractGuard() {
  const tesseract = window.Tesseract;
  if (!tesseract?.createWorker || tesseract.createWorker.__ripscanStallGuard === true) return false;
  const originalCreateWorker = tesseract.createWorker.bind(tesseract);
  const guardedCreateWorker = async (...arguments_) => {
    const optionsIndex = arguments_.findIndex(value => value && typeof value === 'object' && !Array.isArray(value));
    const options = optionsIndex >= 0 ? { ...arguments_[optionsIndex] } : {};
    const originalLogger = options.logger;
    options.logger = message => {
      originalLogger?.(message);
      emitProgress({
        status: 'tesseract_heartbeat', stage: 'worker', progress: Number(state.latest?.progress || 0.18),
        label: workerLabel(message), workerStatus: message?.status, workerProgress: Number(message?.progress || 0),
      });
    };
    if (optionsIndex >= 0) arguments_[optionsIndex] = options;
    else arguments_.push(options);

    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        if (attempt > 0) {
          state.workerStartRetries = 1;
          emitProgress({
            status: 'worker_retry', stage: 'worker_retry', progress: Number(state.latest?.progress || 0.18),
            retryRegions: 1, label: 'Worker เริ่มไม่สำเร็จ · กำลังเริ่มใหม่อัตโนมัติ 1/1',
            issueType: 'WORKER_START_AUTO_RETRY',
          });
        }
        const worker = await withDeadline(
          () => originalCreateWorker(...arguments_),
          WORKER_START_TIMEOUT_MS,
          'OCR_WORKER_START_TIMEOUT',
          () => emitProgress({
            status: 'worker_start_timeout', stage: 'timeout', progress: Number(state.latest?.progress || 0.18),
            retryRegions: attempt, label: 'เริ่ม OCR Worker เกิน 45 วินาที', issueType: 'OCR_WORKER_START_TIMEOUT',
          }),
        );
        return wrapWorker(worker);
      } catch (error) {
        lastError = error;
        if (attempt >= 1 || !/TIMEOUT|WORKER|LOAD/u.test(String(error?.code || error?.message || ''))) throw error;
      }
    }
    throw lastError || timeoutError('OCR_WORKER_START_FAILED');
  };
  Object.defineProperty(guardedCreateWorker, '__ripscanStallGuard', { value: true });
  tesseract.createWorker = guardedCreateWorker;
  return true;
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
    $('#cancelProcessingButton', panel)?.addEventListener('click', () => cancelProcessing('user'));
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
    '#ocrProgressRetry': String(detail.retryRegions ?? state.workerStartRetries ?? 0),
    '#ocrProgressEta': formatDuration(detail.etaMs),
  };
  for (const [selector, value] of Object.entries(values)) {
    const element = $(selector, panel);
    if (element) element.textContent = value;
  }
  setBusy(!['complete', 'cancelled', 'failed', 'timed_out'].includes(detail.status));
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

async function boundedCancel() {
  const operations = [
    window.RipScanBookOCR?.cancel?.(),
    window.RipScanLegacyOCR?.cancel?.(),
    window.RipScanPerformanceRuntime?.cancelAll?.('OCR_HARD_TIMEOUT'),
  ];
  await Promise.race([
    Promise.allSettled(operations),
    new Promise(resolve => setTimeout(resolve, 3_000)),
  ]);
}

async function cancelProcessing(reason = 'user') {
  if (state.hardTimeoutHandling) return;
  state.hardTimeoutHandling = true;
  const button = $('#cancelProcessingButton');
  if (button) {
    button.disabled = true;
    button.textContent = reason === 'timeout' ? 'กำลังหยุด Worker ที่ค้าง…' : 'กำลังยกเลิก…';
  }
  state.cancelledAt = performance.now();
  try {
    await boundedCancel();
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = 'ยกเลิกการประมวลผล';
    }
    const message = reason === 'timeout'
      ? 'หยุด Worker ที่ค้างแล้ว · กรุณากดเริ่มใหม่ ระบบจะไม่ปล่อยงานค้างต่อ'
      : 'ยกเลิกแล้ว · เก็บผลที่ประมวลผลสำเร็จก่อนยกเลิก';
    const statusText = $('#statusText');
    if (statusText) statusText.textContent = message;
    if (reason === 'timeout') {
      const error = $('#error');
      if (error) {
        error.hidden = false;
        error.textContent = 'OCR Worker ไม่ตอบภายในเวลาที่กำหนด ระบบหยุดงานให้อัตโนมัติแล้ว กรุณาลองใหม่อีกครั้ง';
      }
      scheduleRender({ status: 'timed_out', stage: 'timeout', progress: Number(state.latest?.progress || 0), label: 'หยุด Worker ที่ค้างแล้ว' });
    }
    setBusy(false);
    state.hardTimeoutHandling = false;
  }
}

function startWatchdog() {
  if (state.watchdog) return;
  state.watchdog = setInterval(() => {
    installTesseractGuard();
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
      if (detail) detail.textContent = 'กำลัง Terminate งานที่ค้างโดยอัตโนมัติ';
      window.dispatchEvent(new CustomEvent('ripscan:ocr-watchdog', { detail: { idleMs: idle, level: 'timeout' } }));
      void cancelProcessing('timeout');
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
  state.workerStartRetries = 0;
  setBusy(true);
});
window.addEventListener('ripscan:job-end', event => {
  if (!['legacy-ocr', 'ocr'].includes(String(event.detail?.type || ''))) return;
  setBusy(false);
});
window.addEventListener('beforeunload', () => {
  clearInterval(state.watchdog);
  clearTimeout(state.timer);
});

document.addEventListener('click', event => {
  if (event.target.closest('#clearScanPagesButton, #clearButton')) void boundedCancel();
});

installTesseractGuard();
ensurePanel();
startWatchdog();
document.documentElement.dataset.ocrPerformanceVersion = UI_VERSION;
