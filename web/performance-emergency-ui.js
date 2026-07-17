import {
  JobCache,
  LongTaskGuard,
  ResourceManager,
  SharedJobScheduler,
  performanceConfig,
  shouldUseLargeFileMode,
} from './performance-runtime.mjs';

const VERSION = '4.1.0';
const resources = new ResourceManager();
const scheduler = new SharedJobScheduler(performanceConfig());
const cache = new JobCache();
const activeUiJobs = new Map();
let safeModeReason = '';
let progressFrame = 0;
let pendingProgress = null;

function setSafeMode(enabled, reason = '') {
  document.documentElement.dataset.ripscanSafeMode = enabled ? 'true' : 'false';
  if (enabled) {
    safeModeReason = reason || safeModeReason || 'อุปกรณ์หรือไฟล์มีภาระสูง';
    scheduler.enterSafeMode();
    document.dispatchEvent(new CustomEvent('ripscan:safe-mode', { detail: { enabled: true, reason: safeModeReason } }));
  } else {
    safeModeReason = '';
    scheduler.leaveSafeMode();
    document.dispatchEvent(new CustomEvent('ripscan:safe-mode', { detail: { enabled: false, reason: '' } }));
  }
}

function fileMetrics(files = []) {
  let fileSize = 0;
  let width = 0;
  let height = 0;
  for (const file of files) {
    fileSize += Number(file?.size || 0);
    width = Math.max(width, Number(file?.width || 0));
    height = Math.max(height, Number(file?.height || 0));
  }
  return { fileSize, width, height };
}

function pageMetrics() {
  const pageCount = document.querySelectorAll('.page-card,.studio-page-thumb,.pdf-organizer-item').length;
  const regions = document.querySelectorAll('[data-region-id],.book-region,.cover-region-item').length;
  const cells = document.querySelectorAll('.studio-editable-table td,.studio-editable-table th,[data-cell-id]').length;
  return { pageCount, regions, cells };
}

function evaluateSafeMode(files = []) {
  const metrics = { ...fileMetrics(files), ...pageMetrics(), queueLength: scheduler.snapshot().jobCount };
  const enabled = shouldUseLargeFileMode(metrics);
  if (enabled) {
    const reasons = [];
    if (metrics.pageCount > 20) reasons.push(`${metrics.pageCount} หน้า`);
    if (metrics.fileSize > 20 * 1024 * 1024) reasons.push('ไฟล์ใหญ่กว่า 20 MB');
    if (metrics.regions > 100) reasons.push(`${metrics.regions} regions`);
    if (metrics.cells > 500) reasons.push(`${metrics.cells} cells`);
    if (Math.max(metrics.width, metrics.height) > 4000) reasons.push('ภาพความละเอียดสูง');
    setSafeMode(true, reasons.join(' · ') || 'อุปกรณ์ทรัพยากรจำกัด');
  }
  return enabled;
}

function beginUiJob(key, controller = new AbortController()) {
  if (activeUiJobs.has(key)) return null;
  const job = { key, controller, startedAt: performance.now() };
  activeUiJobs.set(key, job);
  return job;
}

function endUiJob(key) {
  const job = activeUiJobs.get(key);
  if (!job) return false;
  activeUiJobs.delete(key);
  resources.cleanupJob(key);
  return true;
}

function cancelUiJob(key, reason = 'USER_CANCELLED') {
  const job = activeUiJobs.get(key);
  if (!job) return false;
  job.controller.abort(reason);
  scheduler.cancel(key, reason);
  return endUiJob(key);
}

function throttleProgress(detail) {
  pendingProgress = detail;
  if (progressFrame) return;
  progressFrame = requestAnimationFrame(() => {
    progressFrame = 0;
    const current = pendingProgress;
    pendingProgress = null;
    if (current) document.dispatchEvent(new CustomEvent('ripscan:progress-batched', { detail: current }));
  });
}

function installDuplicateStartGuard() {
  document.addEventListener('click', event => {
    const button = event.target.closest('#runButton,[data-pdf-action="run"],[data-studio-action="export"],[data-studio-action="convert"]');
    if (!button) return;
    const key = button.id || button.dataset.pdfAction || button.dataset.studioAction || 'primary-job';
    if (button.dataset.jobRunning === 'true' || activeUiJobs.has(key)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    button.dataset.jobRunning = 'true';
    beginUiJob(key);
    window.setTimeout(() => {
      if (!activeUiJobs.has(key)) button.dataset.jobRunning = 'false';
    }, 0);
  }, true);

  document.addEventListener('ripscan:job-finished', event => {
    const key = String(event.detail?.id || event.detail?.key || 'primary-job');
    endUiJob(key);
    document.querySelectorAll('[data-job-running="true"]').forEach(button => { button.dataset.jobRunning = 'false'; });
  });

  document.addEventListener('ripscan:job-cancel', event => {
    const key = String(event.detail?.id || event.detail?.key || 'primary-job');
    cancelUiJob(key);
    document.querySelectorAll('[data-job-running="true"]').forEach(button => { button.dataset.jobRunning = 'false'; });
  });
}

function installLifecycleCleanup() {
  const cleanupDocument = () => {
    scheduler.cancelAll('DOCUMENT_CLOSED');
    activeUiJobs.clear();
    cache.clear();
    resources.cleanup();
    if (progressFrame) cancelAnimationFrame(progressFrame);
    progressFrame = 0;
    pendingProgress = null;
    document.querySelectorAll('[data-job-running="true"]').forEach(button => { button.dataset.jobRunning = 'false'; });
  };

  document.addEventListener('click', event => {
    if (event.target.closest('#clearScanPagesButton,[data-studio-action="close"],[data-pdf-action="close-workspace"]')) cleanupDocument();
  }, true);
  window.addEventListener('pagehide', cleanupDocument, { once: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) scheduler.pause('thumbnail');
    else if (!scheduler.snapshot().safeMode) scheduler.resume('thumbnail');
  });
}

function installFileGuard() {
  document.addEventListener('change', event => {
    if (event.target.matches('input[type="file"]')) evaluateSafeMode([...(event.target.files || [])]);
  }, true);
  document.addEventListener('ripscan:document-opened', event => evaluateSafeMode(event.detail?.files || []));
}

const longTasks = new LongTaskGuard({
  thresholdMs: 1000,
  onFreezeRisk(sample) {
    setSafeMode(true, `ตรวจพบ Main Thread Long Task ${Math.round(sample.duration)} ms`);
    scheduler.pause('thumbnail');
    document.dispatchEvent(new CustomEvent('ripscan:freeze-risk', { detail: { duration: sample.duration, action: 'safe_mode' } }));
  },
});

installDuplicateStartGuard();
installLifecycleCleanup();
installFileGuard();
longTasks.start();

globalThis.RipScanPerformance = Object.freeze({
  version: VERSION,
  scheduler,
  resources,
  cache,
  evaluateSafeMode,
  setSafeMode,
  beginUiJob,
  endUiJob,
  cancelUiJob,
  throttleProgress,
  snapshot: () => ({ ...scheduler.snapshot(), resources: resources.counts(), activeUiJobs: activeUiJobs.size, safeModeReason }),
});

document.documentElement.dataset.ripscanPerformanceVersion = VERSION;
