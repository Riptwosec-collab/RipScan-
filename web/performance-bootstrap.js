import {
  PERFORMANCE_VERSION,
  JOB_PRIORITY,
  createSharedPerformanceRuntime,
  detectLargeFileMode,
  loadScript,
  yieldToMain,
} from './performance-runtime.mjs';

const rootController = new AbortController();
const { signal } = rootController;
const runtime = createSharedPerformanceRuntime();
const loadedModules = new Map();
const loadedStyles = new Set();
const moduleFailures = new Map();
const debugEnabled = location.hostname === 'localhost' || new URLSearchParams(location.search).get('debugPerformance') === '1';
const state = {
  largeFileMode: detectLargeFileMode({}, runtime.config),
  resultsObserver: null,
  lowMemoryWarningShown: false,
  telemetryEnabled: false,
};

const MODULES = Object.freeze({
  studio: {
    styles: ['/document-studio.css'],
    load: async () => import('./document-studio.js'),
  },
  pdfTools: {
    styles: ['/document-studio.css', '/pdf-tools.css'],
    dependencies: ['studio'],
    load: async () => import('./pdf-tools-ui.js'),
  },
  resultCore: {
    styles: ['/performance-v22.css', '/table-auto.css'],
    load: async () => {
      await import('./performance-v22-ui.js');
      await import('./table-auto-ui.js');
    },
  },
  tableReview: {
    styles: ['/table-review-v31.css'],
    dependencies: ['resultCore'],
    load: async () => import('./table-review-v312.js'),
  },
  coverReview: {
    styles: ['/cover-recovery.css', '/book-ocr.css'],
    dependencies: ['resultCore'],
    load: async () => {
      await import('./cover-recovery-ui.js');
      await import('./cover-ocr-ui.js');
      await import('./book-ocr-ui.js');
    },
  },
});

function loadStyle(href) {
  if (loadedStyles.has(href) || document.querySelector(`link[href="${href}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.dataset.ripscanLazyStyle = 'true';
  document.head.append(link);
  loadedStyles.add(href);
}

async function loadModule(name, { retry = false } = {}) {
  if (loadedModules.has(name)) return loadedModules.get(name);
  if (moduleFailures.has(name) && !retry) throw moduleFailures.get(name);
  const definition = MODULES[name];
  if (!definition) throw new Error(`ไม่พบ Tool ${name}`);
  const promise = (async () => {
    try {
      for (const dependency of definition.dependencies || []) await loadModule(dependency);
      for (const style of definition.styles || []) loadStyle(style);
      const result = await definition.load();
      document.dispatchEvent(new CustomEvent('ripscan:tool-loaded', { detail: { name, version: PERFORMANCE_VERSION } }));
      return result;
    } catch (error) {
      loadedModules.delete(name);
      moduleFailures.set(name, error);
      showToolError(name, error);
      throw error;
    }
  })();
  loadedModules.set(name, promise);
  return promise;
}

async function loadTesseract() {
  return loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@7/dist/tesseract.min.js', { globalName: 'Tesseract', timeoutMs: 25_000 });
}

async function loadJsZip() {
  return loadScript('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js', { globalName: 'JSZip', timeoutMs: 20_000 });
}

function showToolError(tool, error) {
  const box = document.querySelector('#error');
  if (!box) return;
  box.hidden = false;
  box.innerHTML = `<strong>${tool} เปิดไม่สำเร็จ</strong><span>${String(error?.message || error)}</span><button type="button" data-performance-retry="${tool}">ลองใหม่เฉพาะ Tool</button>`;
}

function updateLargeFileMode(files = []) {
  const pageCount = files.reduce((sum, file) => sum + Number(file.__pageCount || 0), 0);
  const fileSize = files.reduce((sum, file) => sum + Number(file.size || 0), 0);
  const pixelCount = files.reduce((sum, file) => sum + Number(file.__pixelCount || 0), 0);
  state.largeFileMode = detectLargeFileMode({ fileSize, pageCount, pixelCount }, runtime.config);
  document.documentElement.dataset.largeFileMode = String(state.largeFileMode.enabled);
  globalThis.RipScanPerformance.largeFileMode = state.largeFileMode;
  runtime.queue.setLimit('heavy', state.largeFileMode.workerLimit);
  if (state.largeFileMode.enabled) showLargeFileNotice();
}

function showLargeFileNotice() {
  let notice = document.querySelector('#performanceLargeFileNotice');
  if (!notice) {
    notice = document.createElement('div');
    notice.id = 'performanceLargeFileNotice';
    notice.className = 'performance-notice';
    notice.innerHTML = '<strong>เปิดโหมดไฟล์ขนาดใหญ่</strong><span>ระบบลดจำนวน Worker และคุณภาพ Preview ชั่วคราว โดยไม่ลดคุณภาพ Export ที่เลือก</span><button type="button" aria-label="ปิด">×</button>';
    document.body.append(notice);
    notice.querySelector('button').addEventListener('click', () => notice.remove(), { once: true });
  }
}

function installLazyEntryButtons() {
  const header = document.querySelector('.header-actions');
  if (!header || document.querySelector('#lazyDocumentStudioButton')) return;
  const studio = document.createElement('button');
  studio.id = 'lazyDocumentStudioButton';
  studio.className = 'studio-entry-button';
  studio.type = 'button';
  studio.textContent = 'Document Studio';
  const convert = document.createElement('button');
  convert.id = 'lazyConvertCenterButton';
  convert.className = 'studio-entry-button';
  convert.type = 'button';
  convert.textContent = 'แปลงไฟล์';
  header.prepend(convert);
  header.prepend(studio);
  studio.addEventListener('pointerenter', () => loadModule('studio').catch(() => {}), { once: true, passive: true });
  convert.addEventListener('pointerenter', () => loadModule('pdfTools').catch(() => {}), { once: true, passive: true });
  studio.addEventListener('click', async () => {
    studio.disabled = true;
    studio.textContent = 'กำลังเปิด…';
    try {
      studio.remove();
      convert.remove();
      await loadModule('studio');
      document.querySelector('#documentStudioButton')?.click();
    } catch {
      studio.disabled = false;
      studio.textContent = 'Document Studio';
      installLazyEntryButtons();
    }
  });
  convert.addEventListener('click', async () => {
    convert.disabled = true;
    convert.textContent = 'กำลังเปิด…';
    try {
      studio.remove();
      convert.remove();
      await loadModule('pdfTools');
      document.querySelector('#convertCenterButton')?.click();
    } catch {
      convert.disabled = false;
      convert.textContent = 'แปลงไฟล์';
      installLazyEntryButtons();
    }
  });
}

function structuredFile(file) {
  return /\.(docx|xlsx|xls|pptx|txt|csv|html?|rtf|odt|ods|odp|json)$/iu.test(file?.name || '');
}

function installFileGuards() {
  const input = document.querySelector('#fileInput');
  if (!input) return;
  input.accept = '.pdf,.jpg,.jpeg,.png,.webp,.bmp,.tif,.tiff,.docx,.xlsx,.xls,.pptx,.txt,.csv,.html,.htm,.rtf,.odt,.ods,.odp,.json';
  input.addEventListener('change', async event => {
    const files = [...(event.target.files || [])];
    updateLargeFileMode(files);
    if (!files.some(structuredFile)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    try {
      await loadModule('studio');
      await globalThis.RipScanDocumentStudio.importFiles(files);
    } catch (error) {
      showToolError('studio', error);
    } finally {
      event.target.value = '';
    }
  }, { capture: true, signal });
  input.addEventListener('pointerenter', () => loadModule('studio').catch(() => {}), { once: true, passive: true });
}

function installOcrPreload() {
  const run = document.querySelector('#runButton');
  if (!run) return;
  const warm = () => Promise.allSettled([loadTesseract(), loadModule('resultCore')]);
  run.addEventListener('pointerenter', warm, { once: true, passive: true });
  run.addEventListener('focus', warm, { once: true, passive: true });
  run.addEventListener('click', () => {
    loadModule('resultCore').then(() => Promise.allSettled([loadModule('tableReview'), loadModule('coverReview')])).catch(() => {});
  }, { capture: true, signal });
}

function observeResults() {
  const results = document.querySelector('#results');
  if (!results || state.resultsObserver) return;
  let scheduled = false;
  const schedule = () => {
    if (scheduled || !results.children.length) return;
    scheduled = true;
    const idle = globalThis.requestIdleCallback || (callback => setTimeout(callback, 80));
    idle(async () => {
      scheduled = false;
      await loadModule('resultCore').catch(() => {});
      const cards = [...results.querySelectorAll('.page-card')];
      if (!cards.length) return;
      await Promise.allSettled([loadModule('tableReview'), loadModule('coverReview')]);
    }, { timeout: 1200 });
  };
  state.resultsObserver = new MutationObserver(schedule);
  state.resultsObserver.observe(results, { childList: true });
  schedule();
}

function settingsHtml() {
  const selected = runtime.config.mode;
  return `<details class="performance-settings" id="performanceSettings"><summary>ประสิทธิภาพ <span>${runtime.config.resolvedMode}</span></summary><div class="performance-settings-grid"><label>โหมด<select id="performanceMode"><option value="auto">อัตโนมัติ</option><option value="saver">ประหยัดทรัพยากร</option><option value="balanced">สมดุล</option><option value="performance">ประสิทธิภาพสูง</option></select></label><label>Worker งานหนัก<input id="performanceWorkers" type="number" min="1" max="4" value="${runtime.config.lanes.heavy}"></label><label>OCR Variant สูงสุด<input id="performanceVariants" type="number" min="1" max="6" value="${runtime.config.ocrVariantLimit}"></label><label>Undo History<input id="performanceHistory" type="number" min="10" max="100" value="${runtime.config.historyLimit}"></label><label class="performance-check"><input id="performanceAutoNext" type="checkbox" ${runtime.config.autoProcessNextPage ? 'checked' : ''}> ประมวลผลหน้าถัดไปอัตโนมัติ</label><label class="performance-check"><input id="performanceOffscreen" type="checkbox" ${runtime.config.offscreenCanvas ? 'checked' : ''}> ใช้ OffscreenCanvas</label><button type="button" id="clearPerformanceCache">ล้างข้อมูลชั่วคราว</button><small>ค่าจะใช้กับงานถัดไป ไม่เก็บเนื้อหาเอกสารหรือข้อความ OCR</small></div></details>`;
}

function installSettings() {
  const controls = document.querySelector('.settings-panel .controls');
  if (!controls || document.querySelector('#performanceSettings')) return;
  controls.insertAdjacentHTML('afterend', settingsHtml());
  const mode = document.querySelector('#performanceMode');
  mode.value = runtime.config.mode;
  mode.addEventListener('change', () => {
    try { localStorage.setItem('ripscan-performance-mode', mode.value); } catch {}
    location.reload();
  }, { signal });
  document.querySelector('#performanceWorkers')?.addEventListener('change', event => runtime.queue.setLimit('heavy', Math.max(1, Math.min(4, Number(event.target.value) || 1))), { signal });
  document.querySelector('#clearPerformanceCache')?.addEventListener('click', async event => {
    event.target.disabled = true;
    runtime.cache.clear();
    runtime.resources.cleanupAll();
    try {
      const names = await caches.keys();
      await Promise.all(names.filter(name => name.includes('-runtime')).map(name => caches.delete(name)));
    } catch {}
    event.target.textContent = 'ล้างแล้ว';
    setTimeout(() => { event.target.disabled = false; event.target.textContent = 'ล้างข้อมูลชั่วคราว'; }, 1200);
  }, { signal });
}

function installToolRetry() {
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-performance-retry]');
    if (!button) return;
    const name = button.dataset.performanceRetry;
    moduleFailures.delete(name);
    loadModule(name, { retry: true }).catch(() => {});
  }, { signal });
}

function monitorMemory() {
  if (!performance.memory) return;
  const timer = setInterval(() => {
    const used = performance.memory.usedJSHeapSize || 0;
    if (used < runtime.config.lowMemoryBytesThreshold) return;
    runtime.queue.pause();
    runtime.cache.clear();
    runtime.resources.cleanupAll();
    runtime.queue.setLimit('heavy', 1);
    runtime.queue.resume();
    document.documentElement.dataset.lowMemoryRecovery = 'true';
    if (!state.lowMemoryWarningShown) {
      state.lowMemoryWarningShown = true;
      const notice = document.createElement('div');
      notice.className = 'performance-notice low-memory';
      notice.innerHTML = '<strong>หน่วยความจำของอุปกรณ์เหลือน้อย</strong><span>ระบบลดคุณภาพ Preview ชั่วคราวเพื่อให้ทำงานต่อได้อย่างเสถียร ผล Export ยังคงใช้คุณภาพที่เลือก</span><button type="button">×</button>';
      document.body.append(notice);
      notice.querySelector('button').addEventListener('click', () => notice.remove(), { once: true });
    }
  }, 4000);
  signal.addEventListener('abort', () => clearInterval(timer), { once: true });
}

function installVisibilityGuards() {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) runtime.queue.pause();
    else runtime.queue.resume();
  }, { signal });
  addEventListener('pagehide', () => {
    rootController.abort();
    state.resultsObserver?.disconnect();
    runtime.queue.cancelAll();
    runtime.resources.cleanupAll();
    runtime.metrics.stop();
  }, { once: true });
}

function installDevelopmentPanel() {
  if (!debugEnabled || document.querySelector('#performanceDebugPanel')) return;
  const panel = document.createElement('aside');
  panel.id = 'performanceDebugPanel';
  panel.className = 'performance-debug-panel';
  panel.innerHTML = '<strong>RipScan Performance</strong><pre></pre>';
  document.body.append(panel);
  const pre = panel.querySelector('pre');
  const timer = setInterval(() => {
    pre.textContent = JSON.stringify({ version: PERFORMANCE_VERSION, queue: runtime.queue.snapshot(), metrics: runtime.metrics.snapshot(runtime.resources), largeFileMode: state.largeFileMode }, null, 2);
  }, 500);
  signal.addEventListener('abort', () => clearInterval(timer), { once: true });
}

function installLongTaskRecovery() {
  document.addEventListener('ripscan:long-task', event => {
    if (Number(event.detail?.duration || 0) > 800) runtime.queue.setLimit('heavy', 1);
  }, { signal });
}

runtime.metrics.start();
loadStyle('/performance-v5.css');
installLazyEntryButtons();
installFileGuards();
installOcrPreload();
observeResults();
installSettings();
installToolRetry();
installVisibilityGuards();
installDevelopmentPanel();
installLongTaskRecovery();
monitorMemory();

const publicApi = {
  version: PERFORMANCE_VERSION,
  runtime,
  config: runtime.config,
  resources: runtime.resources,
  queue: runtime.queue,
  cache: runtime.cache,
  metrics: runtime.metrics,
  loadModule,
  loadTesseract,
  loadJsZip,
  loadScript,
  yieldToMain,
  largeFileMode: state.largeFileMode,
  cleanupDocumentResources: id => runtime.resources.cleanupDocumentResources(id),
  cleanupJobResources: id => runtime.resources.cleanupJobResources(id),
};

globalThis.RipScanPerformance = publicApi;
document.documentElement.dataset.performanceVersion = PERFORMANCE_VERSION;
document.dispatchEvent(new CustomEvent('ripscan:performance-ready', { detail: { version: PERFORMANCE_VERSION } }));
