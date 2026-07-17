import { loadJsZip } from './lazy-libraries.mjs';

const loaded = new Map();
const structuredExtensions = new Set(['docx', 'xlsx', 'xls', 'pptx', 'txt', 'csv', 'html', 'htm', 'rtf', 'odt', 'ods', 'odp', 'json']);
const zippedOfficeExtensions = new Set(['docx', 'pptx', 'odt', 'ods', 'odp']);
let resultsObserver = null;

function extensionOf(file) {
  return String(file?.name || '').split('.').pop()?.toLowerCase() || '';
}

function loadStyle(href) {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.dataset.ripscanLazyStyle = 'true';
  document.head.append(link);
}

function loadModule(key, url, styles = []) {
  if (loaded.has(key)) return loaded.get(key);
  styles.forEach(loadStyle);
  const promise = import(url).catch(error => {
    loaded.delete(key);
    throw error;
  });
  loaded.set(key, promise);
  return promise;
}

async function loadStudio() {
  await loadModule('studio', '/document-studio.js', ['/document-studio.css']);
  document.querySelector('#documentStudioLazyButton')?.remove();
  document.querySelector('#convertCenterLazyButton')?.remove();
  return globalThis.RipScanDocumentStudio;
}

async function loadPdfTools() {
  await loadStudio();
  await loadModule('pdf-tools', '/pdf-tools-ui.js', ['/pdf-tools.css']);
}

async function loadBookReview() {
  return loadModule('book-review', '/book-ocr-ui.js', ['/book-ocr.css']);
}

async function loadTableTools() {
  await loadModule('table-review', '/table-review-v312.js', ['/table-auto.css', '/table-review-v31.css']);
  return loadModule('table-auto', '/table-auto-ui.js');
}

async function loadCoverReview() {
  await Promise.all([
    loadModule('cover-review', '/cover-ocr-ui.js', ['/cover-recovery.css']),
    loadModule('cover-recovery', '/cover-recovery-ui.js'),
    loadBookReview(),
    loadTableTools(),
  ]);
}

function removeLazyLaunchers() {
  document.querySelector('#documentStudioLazyButton')?.remove();
  document.querySelector('#convertCenterLazyButton')?.remove();
}

function makeLauncher(id, label, action) {
  const button = document.createElement('button');
  button.id = id;
  button.className = 'studio-entry-button';
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('pointerenter', () => action(true), { once: true });
  button.addEventListener('click', () => action(false));
  return button;
}

function installLaunchers() {
  const actions = document.querySelector('.header-actions');
  if (!actions || document.querySelector('#documentStudioButton,#documentStudioLazyButton')) return;
  const studio = makeLauncher('documentStudioLazyButton', 'Document Studio', async preload => {
    await loadStudio();
    if (!preload) document.querySelector('#documentStudioButton')?.click();
  });
  const convert = makeLauncher('convertCenterLazyButton', 'แปลงไฟล์', async preload => {
    await loadPdfTools();
    if (!preload) document.querySelector('#convertCenterButton')?.click();
  });
  actions.prepend(convert);
  actions.prepend(studio);
}

async function handleStructuredFiles(input, files) {
  const structured = files.filter(file => structuredExtensions.has(extensionOf(file)));
  if (!structured.length) return false;
  if (structured.some(file => zippedOfficeExtensions.has(extensionOf(file)))) await loadJsZip();
  const studio = await loadStudio();
  await studio?.importFiles?.(structured);
  input.value = '';
  return true;
}

function addAdvancedButtons() {
  document.querySelectorAll('.result-card').forEach(card => {
    if (card.querySelector('[data-lazy-advanced-review]')) return;
    const head = card.querySelector('.result-head');
    if (!head) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.lazyAdvancedReview = 'true';
    button.textContent = 'ตรวจขั้นสูง';
    button.addEventListener('click', async () => {
      button.disabled = true;
      button.textContent = 'กำลังเปิดเครื่องมือ…';
      try {
        await loadCoverReview();
        button.remove();
      } catch (error) {
        button.disabled = false;
        button.textContent = 'เปิดเครื่องมือไม่สำเร็จ';
        console.error(error);
      }
    });
    head.append(button);
  });
}

function installResultsObserver() {
  const results = document.querySelector('#results');
  if (!results || resultsObserver) return;
  resultsObserver = new MutationObserver(addAdvancedButtons);
  resultsObserver.observe(results, { childList: true, subtree: true });
  addAdvancedButtons();
}

const fileInput = document.querySelector('#fileInput');
if (fileInput) {
  fileInput.accept = '.pdf,.jpg,.jpeg,.png,.webp,.bmp,.tif,.tiff,.docx,.xlsx,.xls,.pptx,.txt,.csv,.html,.htm,.rtf,.odt,.ods,.odp,.json';
}

document.addEventListener('change', event => {
  if (event.target.id !== 'fileInput') return;
  const files = [...(event.target.files || [])];
  if (!files.some(file => structuredExtensions.has(extensionOf(file)))) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  handleStructuredFiles(event.target, files).catch(error => {
    console.error(error);
    const box = document.querySelector('#error');
    if (box) { box.hidden = false; box.textContent = error?.message || 'เปิดเอกสารไม่สำเร็จ'; }
  });
}, true);

document.addEventListener('pointerenter', event => {
  if (event.target.closest('#runButton')) loadModule('progress-ui', '/performance-v22-ui.js', ['/performance-v22.css']);
}, true);

document.addEventListener('click', event => {
  if (event.target.closest('#runButton')) loadModule('progress-ui', '/performance-v22-ui.js', ['/performance-v22.css']);
}, true);

window.addEventListener('ripscan:job-end', () => {
  queueMicrotask(() => loadBookReview().then(addAdvancedButtons).catch(console.error));
  if (!window.RipScanPerformanceRuntime?.state?.safeMode) {
    const start = () => loadTableTools().catch(console.error);
    if ('requestIdleCallback' in window) requestIdleCallback(start, { timeout: 1500 });
    else setTimeout(start, 250);
  }
});

window.addEventListener('ripscan:structured-table-ready', () => loadModule('table-review', '/table-review-v312.js', ['/table-auto.css', '/table-review-v31.css']));
window.addEventListener('pagehide', () => { resultsObserver?.disconnect(); resultsObserver = null; loaded.clear(); }, { once: true });

installLaunchers();
installResultsObserver();

globalThis.RipScanToolLoader = Object.freeze({
  loadStudio,
  loadPdfTools,
  loadBookReview,
  loadTableTools,
  loadCoverReview,
  removeLazyLaunchers,
  loadedTools: () => [...loaded.keys()],
});
