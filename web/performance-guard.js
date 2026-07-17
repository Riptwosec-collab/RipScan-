import {
  JobCache,
  LongTaskGuard,
  ResourceManager,
  SharedJobScheduler,
  performanceConfig,
  shouldUseLargeFileMode,
} from './performance-runtime.mjs';

const state = {
  config: performanceConfig(),
  safeMode: false,
  reasons: new Set(),
  activeJobs: new Set(),
  lastLongTask: null,
};

const scheduler = new SharedJobScheduler(state.config);
const resources = new ResourceManager();
const cache = new JobCache({ limit: state.config.cacheLimit });

function emit(name, detail = {}) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function setDocumentMode() {
  document.documentElement.dataset.performanceMode = state.safeMode ? 'safe' : 'auto';
  document.documentElement.dataset.performanceWorkers = String(scheduler.config.heavyConcurrency);
}

function enterSafeMode(reason, detail = {}) {
  if (reason) state.reasons.add(reason);
  state.safeMode = true;
  state.config = performanceConfig({ safeMode: true });
  scheduler.enterSafeMode();
  setDocumentMode();
  emit('ripscan:safe-mode', {
    enabled: true,
    reason,
    reasons: [...state.reasons],
    config: state.config,
    ...detail,
  });
}

function inspectFiles(files) {
  const list = [...(files || [])];
  const fileSize = list.reduce((sum, file) => sum + Number(file.size || 0), 0);
  if (shouldUseLargeFileMode({ fileSize }, navigator)) {
    enterSafeMode('large_or_low_memory_file', { fileSize, fileCount: list.length });
  }
}

const longTaskGuard = new LongTaskGuard({
  thresholdMs: 1000,
  onFreezeRisk(entry) {
    state.lastLongTask = entry;
    scheduler.pause('thumbnail');
    enterSafeMode('main_thread_long_task', { durationMs: entry.duration });
  },
});

function startJob(detail = {}) {
  const id = String(detail.id || detail.jobId || '');
  if (!id) return;
  if (state.activeJobs.has(id)) {
    emit('ripscan:duplicate-job-blocked', { id });
    return;
  }
  state.activeJobs.add(id);
  const queueLength = scheduler.snapshot().jobCount;
  if (shouldUseLargeFileMode({ queueLength }, navigator)) enterSafeMode('queue_pressure', { queueLength });
}

function endJob(detail = {}) {
  const id = String(detail.id || detail.jobId || '');
  if (!id) return;
  state.activeJobs.delete(id);
  resources.cleanupJob(id);
}

function cancelAll(reason = 'USER_CANCELLED') {
  scheduler.cancelAll(reason);
  window.RipScanBookOCR?.cancel?.();
  window.RipScanLegacyOCR?.cancel?.();
  state.activeJobs.clear();
  emit('ripscan:all-jobs-cancelled', { reason });
}

window.addEventListener('ripscan:job-start', event => startJob(event.detail));
window.addEventListener('ripscan:job-end', event => endJob(event.detail));
window.addEventListener('ripscan:job-cancel', event => {
  const id = event.detail?.id || event.detail?.jobId;
  if (id) scheduler.cancel(String(id));
  else cancelAll();
});
window.addEventListener('ripscan:document-close', () => {
  cancelAll('DOCUMENT_CLOSED');
  resources.cleanup();
  cache.clear();
});
window.addEventListener('pagehide', () => {
  longTaskGuard.stop();
  cancelAll('PAGE_HIDDEN');
  resources.cleanup();
  cache.clear();
}, { once: true });

document.addEventListener('change', event => {
  if (event.target?.matches?.('input[type="file"]')) inspectFiles(event.target.files);
}, true);

document.addEventListener('click', event => {
  if (event.target.closest('#clearButton,#clearScanPagesButton,[data-studio-action="close"],[data-pdf-action="cancel"]')) {
    cancelAll('USER_CANCELLED');
    resources.cleanup();
  }
}, true);

longTaskGuard.start();
setDocumentMode();

window.RipScanPerformanceRuntime = Object.freeze({
  scheduler,
  resources,
  cache,
  state,
  enterSafeMode,
  inspectFiles,
  cancelAll,
  snapshot() {
    return {
      ...scheduler.snapshot(),
      resources: resources.counts(),
      cacheSize: cache.size,
      safeMode: state.safeMode,
      reasons: [...state.reasons],
      lastLongTask: state.lastLongTask,
    };
  },
});
