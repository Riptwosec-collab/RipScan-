import { readFile, writeFile } from 'node:fs/promises';

function replaceRequired(source, search, replacement, label) {
  // Source files are copied from Windows working trees, so normalize line
  // endings before applying literal build transforms.
  source = source.replace(/\r\n/g, '\n');
  for (const candidate of Array.isArray(search) ? search : [search]) {
    const result = source.replace(candidate, replacement);
    if (result !== source) return result;
  }
  throw new Error(`Performance build patch failed: ${label}`);
}

const appPath = 'dist/app.js';
let app = await readFile(appPath, 'utf8');
const appUsesCentralLazyRuntime = app.includes("import { loadPdfJs, loadTesseract } from './lazy-libraries.mjs';");
if (!appUsesCentralLazyRuntime) app = replaceRequired(
  app,
  [
    "import * as pdfjsLib from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs';\n\npdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';",
    "import * as pdfjsLib from '/vendor/pdf.min.mjs';\n\npdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.mjs';",
  ],
  [
    'let pdfjsLibPromise;',
    'async function ensurePdfJs() {',
    "  pdfjsLibPromise ||= import('./lazy-libraries.mjs').then(module => module.loadPdfJs());",
    '  return pdfjsLibPromise;',
    '}',
  ].join('\n'),
  'lazy PDF.js import',
);
if (!appUsesCentralLazyRuntime) app = replaceRequired(
  app,
  "  if (!window.Tesseract?.createWorker) throw new Error('โหลดระบบ OCR ไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตแล้วรีเฟรชหน้า');",
  [
    "  if (!window.Tesseract?.createWorker) await import('./lazy-libraries.mjs').then(module => module.loadTesseract());",
    "  if (!window.Tesseract?.createWorker) throw new Error('โหลดระบบ OCR ไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตแล้วรีเฟรชหน้า');",
  ].join('\n'),
  'lazy Tesseract loading',
);
app = app.replace('  canvas.width = 1;\n  canvas.height = 1;', '  canvas.width = 0;\n  canvas.height = 0;');

const recognitionPattern = /async function recognizeWithAutoEnhancement\(sourceCanvas, label\) \{[\s\S]*?\n\}\n\nasync function processImage/;
const recognitionReplacement = [
  'async function recognizeWithAutoEnhancement(sourceCanvas, label) {',
  "  const module = await import('./book-ocr-browser-emergency.mjs');",
  '  const result = await module.processBookCoverCanvas(sourceCanvas, {',
  "    documentType: 'auto',",
  '    fileName: label,',
  '    pageNumber: Number((label.match(/หน้า (\\d+)/u) || [])[1] || 1),',
  '    signal: state.activeController?.signal,',
  '    options: { performanceWorker: true, emergencySafeMode: Boolean(state.safeMode) },',
  '    onProgress(message) {',
  '      const percent = Math.round(Number(message.progress || 0) * 100);',
  "      statusText.textContent = label + ' · ' + (message.label || message.status || 'OCR') + ' · ' + percent + '%';",
  '    },',
  '  });',
  '  return {',
  '    text: result.text,',
  '    confidence: result.confidence,',
  "    source: 'ocr-worker-regions',",
  "    bestVariant: result.pipeline || 'Worker Region OCR',",
  '    deskewAngle: 0,',
  '    enhancedPreviewUrl: null,',
  "    attempts: (result.blocks || []).filter(block => block.text).slice(0, 12).map(block => ({ name: block.zone || block.type || 'block', confidence: Number(block.confidence || 0) })),",
  '    performance: result.performance,',
  '  };',
  '}',
  '',
  'async function processImage',
].join('\n');
app = replaceRequired(app, recognitionPattern, recognitionReplacement, 'worker OCR delegation');

if (!appUsesCentralLazyRuntime) app = replaceRequired(
  app,
  'async function processPdf(file, fileIndex) {\n  const data = new Uint8Array(await file.arrayBuffer());',
  'async function processPdf(file, fileIndex) {\n  const pdfjsLib = await ensurePdfJs();\n  const data = new Uint8Array(await file.arrayBuffer());',
  'PDF.js on-demand load',
);
app = replaceRequired(
  app,
  '  const pdf = await loadingTask.promise;\n  if (pdf.numPages > MAX_PDF_PAGES) {',
  [
    '  const pdf = await loadingTask.promise;',
    '  const safeMode = Boolean(window.RipScanPerformanceRuntime?.state?.safeMode) || file.size > 20 * 1024 * 1024 || pdf.numPages > 20;',
    '  state.safeMode = safeMode;',
    "  if (safeMode) window.RipScanPerformanceRuntime?.enterSafeMode?.('large_pdf', { pageCount: pdf.numPages, fileSize: file.size });",
    '  const autoPageLimit = safeMode ? 1 : pdf.numPages;',
    '  if (pdf.numPages > MAX_PDF_PAGES) {',
  ].join('\n'),
  'PDF safe mode detection',
);
app = replaceRequired(app, 'for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1)', 'for (let pageNumber = 1; pageNumber <= autoPageLimit; pageNumber += 1)', 'progressive PDF page limit');
app = replaceRequired(
  app,
  "    pageCount: pages.length,\n    fullText: pages.map(page => page.text).join('\\n\\n').trim(),",
  [
    '    pageCount: pages.length,',
    '    totalPageCount: pdf.numPages,',
    '    safeMode,',
    '    hasRemainingPages: autoPageLimit < pdf.numPages,',
    "    fullText: pages.map(page => page.text).join('\\n\\n').trim(),",
  ].join('\n'),
  'PDF progressive metadata',
);
app = replaceRequired(
  app,
  "${documentData.pages.map((page, pageIndex) => renderPageReview(page, documentIndex, pageIndex)).join('')}",
  "${documentData.pages.length ? renderPageReview(documentData.pages[0], documentIndex, 0) : ''}",
  'page DOM virtualization',
);

const switchPattern = /function switchPage\(documentIndex, pageIndex\) \{[\s\S]*?\n\}/;
const switchReplacement = [
  'function switchPage(documentIndex, pageIndex) {',
  "  const card = results.querySelector('.result-card[data-document=\"' + documentIndex + '\"]');",
  '  const page = state.documents[documentIndex]?.pages[pageIndex];',
  '  if (!card || !page) return;',
  "  const list = card.querySelector('.page-list');",
  '  if (list) list.innerHTML = renderPageReview(page, documentIndex, pageIndex);',
  "  card.querySelectorAll('.page-tab').forEach((tab, index) => tab.classList.toggle('active', index === pageIndex));",
  '  updateViewer(documentIndex, pageIndex);',
  '}',
].join('\n');
app = replaceRequired(app, switchPattern, switchReplacement, 'virtual page switching');

app = app.replace(
  'state.histories.set(key, { current: page.text, undo: [], redo: [] });',
  'state.histories.set(key, { current: page.text, undo: [], redo: [], timer: null, pendingBefore: null, pendingValue: page.text });',
);
const historyPattern = /function recordEditorInput\(textarea\) \{[\s\S]*?\n\}/;
const historyReplacement = [
  'function flushPendingHistory(history) {',
  '  if (!history || history.pendingBefore === null) return;',
  '  clearTimeout(history.timer);',
  '  history.undo.push(history.pendingBefore);',
  '  const limit = state.safeMode ? 20 : 50;',
  '  if (history.undo.length > limit) history.undo.splice(0, history.undo.length - limit);',
  '  history.current = history.pendingValue;',
  '  history.pendingBefore = null;',
  '  history.redo = [];',
  '}',
  '',
  'function recordEditorInput(textarea) {',
  '  const documentIndex = Number(textarea.dataset.document);',
  '  const pageIndex = Number(textarea.dataset.page);',
  '  const key = pageKey(documentIndex, pageIndex);',
  '  const history = state.histories.get(key);',
  '  if (!history || textarea.value === history.pendingValue) return;',
  '  if (history.pendingBefore === null) history.pendingBefore = history.current;',
  '  history.pendingValue = textarea.value;',
  '  clearTimeout(history.timer);',
  '  history.timer = setTimeout(() => {',
  '    flushPendingHistory(history);',
  '    updateHistoryButtons(documentIndex, pageIndex);',
  '  }, 250);',
  "  const stats = document.querySelector('[data-text-stats=\"' + key + '\"]');",
  '  if (stats) stats.textContent = textStats(textarea.value);',
  '}',
].join('\n');
app = replaceRequired(app, historyPattern, historyReplacement, 'debounced editor history');
app = app.replace('  const history = state.histories.get(pageKey(documentIndex, pageIndex));\n  if (!history?.undo.length) return;', '  const history = state.histories.get(pageKey(documentIndex, pageIndex));\n  flushPendingHistory(history);\n  if (!history?.undo.length) return;');
app = app.replace('  const history = state.histories.get(pageKey(documentIndex, pageIndex));\n  if (!history?.redo.length) return;', '  const history = state.histories.get(pageKey(documentIndex, pageIndex));\n  flushPendingHistory(history);\n  if (!history?.redo.length) return;');

const runPattern = /runButton\.addEventListener\('click', async \(\) => \{[\s\S]*?\n\}\);/;
const runReplacement = [
  "runButton.addEventListener('click', async () => {",
  '  if (state.activeJobId) return;',
  '  errorBox.hidden = true;',
  "  results.innerHTML = '';",
  '  state.documents = [];',
  '  cleanupObjectUrls();',
  "  state.activeJobId = 'legacy-ocr-' + Date.now();",
  '  state.activeController = new AbortController();',
  '  state.cancelled = false;',
  '  window.RipScanPerformanceRuntime?.inspectFiles?.(state.files);',
  "  window.dispatchEvent(new CustomEvent('ripscan:job-start', { detail: { id: state.activeJobId, type: 'legacy-ocr' } }));",
  "  setBusy(true, 'กำลังเตรียมเอกสารและปรับภาพอัตโนมัติ…');",
  '  try {',
  '    const documents = [];',
  '    for (let index = 0; index < state.files.length; index += 1) {',
  "      if (state.activeController.signal.aborted || state.cancelled) throw new DOMException('ยกเลิกแล้ว', 'AbortError');",
  '      documents.push(await processFile(state.files[index], index));',
  '      renderResults(documents);',
  '      await new Promise(resolve => requestAnimationFrame(resolve));',
  '    }',
  '  } catch (error) {',
  "    if (error?.name !== 'AbortError' && !/CANCEL/u.test(error?.message || '')) {",
  '      console.error(error);',
  "      showError(error?.message || 'แปลงไฟล์ไม่สำเร็จ');",
  '    }',
  '  } finally {',
  '    const finishedJobId = state.activeJobId;',
  '    await cleanupWorker();',
  "    state.activeJobId = '';",
  '    state.activeController = null;',
  '    setBusy(false);',
  "    window.dispatchEvent(new CustomEvent('ripscan:job-end', { detail: { id: finishedJobId, type: 'legacy-ocr' } }));",
  '  }',
  '});',
  '',
  'window.RipScanLegacyOCR = Object.freeze({',
  '  async cancel() {',
  '    state.cancelled = true;',
  '    state.activeController?.abort();',
  '    await Promise.allSettled([cleanupWorker(), window.RipScanBookOCR?.cancel?.()]);',
  '  },',
  '});',
].join('\n');
app = replaceRequired(app, runPattern, runReplacement, 'duplicate-safe cancellable run handler');
await writeFile(appPath, app, 'utf8');

const bookUiPath = 'dist/book-ocr-ui.js';
let bookUi = await readFile(bookUiPath, 'utf8');
bookUi = replaceRequired(bookUi, "from './book-ocr-browser-performance.mjs';", "from './book-ocr-browser-emergency.mjs';", 'emergency OCR wrapper');
await writeFile(bookUiPath, bookUi, 'utf8');

const performanceBrowserPath = 'dist/book-ocr-browser-performance.mjs';
let performanceBrowser = await readFile(performanceBrowserPath, 'utf8');
performanceBrowser = replaceRequired(
  performanceBrowser,
  '    const textRegions = regions.filter(region => shouldOcrRegion(region, { isCover }).allow);',
  "    const textRegions = regions.filter(region => shouldOcrRegion(region, { isCover }).allow);\n    const selectedTextRegions = configuration.options?.emergencySafeMode ? textRegions.slice(0, 100) : textRegions;",
  'safe region cap',
);
const taskPattern = /    const tasks = textRegions\.map\(\(region, index\) => processRegion\([\s\S]*?    await withTimeout\(\(\) => Promise\.all\(tasks\), OCR_LIMITS\.pageTimeoutMs, \(\) => \{ metrics\.timedOut \+= 1; \}\);/;
const taskReplacement = [
  '    let cursor = 0;',
  '    const runRegionQueue = async () => {',
  '      while (cursor < selectedTextRegions.length) {',
  '        const index = cursor++;',
  '        const region = selectedTextRegions[index];',
  '        const block = await processRegion({',
  '          client, pool, jobId, region, index, total: selectedTextRegions.length, page,',
  '          configuration, runId, metrics, cache, fileHash: configuration.fileHash || jobId,',
  '        });',
  '        blocks.push(block);',
  '        completed += 1;',
  '        sampleMemory(metrics);',
  '        const elapsed = Date.now() - metrics.startedAt;',
  '        const eta = completed ? elapsed / completed * (selectedTextRegions.length - completed) : 0;',
  '        emitProgress(configuration, {',
  "          status: 'fast_pass', stage: 'fast_pass', page: pageNumber,",
  '          block: completed, totalBlocks: selectedTextRegions.length,',
  '          textRegions: metrics.regionsOcr, skippedRegions: metrics.regionsSkipped,',
  '          retryRegions: metrics.retries, etaMs: eta,',
  "          progress: progressivePercent('fast_pass', completed, selectedTextRegions.length),",
  "          label: 'ประมวลผล Block ' + completed + '/' + selectedTextRegions.length,",
  '        });',
  '      }',
  '    };',
  '    const runnerCount = Math.max(1, Math.min(workerLimits.ocrWorkers, selectedTextRegions.length || 1));',
  '    const runners = Array.from({ length: runnerCount }, () => runRegionQueue());',
  '    await withTimeout(() => Promise.all(runners), OCR_LIMITS.pageTimeoutMs, () => { metrics.timedOut += 1; });',
].join('\n');
performanceBrowser = replaceRequired(performanceBrowser, taskPattern, taskReplacement, 'bounded region queue');
await writeFile(performanceBrowserPath, performanceBrowser, 'utf8');

const preprocessPath = 'dist/ocr-preprocess-worker.js';
let preprocess = await readFile(preprocessPath, 'utf8');
preprocess = replaceRequired(preprocess, 'const cancelledJobs = new Set();', "const cancelledJobs = new Set();\nconst MAX_VARIANTS_PER_REGION = 4;\nconst MAX_VARIANT_PIXELS = 16_000_000;", 'preprocess limits');
preprocess = replaceRequired(
  preprocess,
  'function resize(source, scale) {\n  const canvas = makeCanvas(source.width * scale, source.height * scale);',
  [
    'function resize(source, scale) {',
    '  const requestedPixels = source.width * source.height * scale * scale;',
    '  const safeScale = requestedPixels > MAX_VARIANT_PIXELS ? Math.sqrt(MAX_VARIANT_PIXELS / Math.max(1, source.width * source.height)) : scale;',
    '  const canvas = makeCanvas(source.width * safeScale, source.height * safeScale);',
  ].join('\n'),
  'variant pixel cap',
);
preprocess = replaceRequired(
  preprocess,
  "  const { jobId, requestId, bbox, variants = ['original', 'upscale2'], saraAmSuspected = false } = message;",
  "  const { jobId, requestId, bbox, variants: requestedVariants = ['original', 'upscale2'], saraAmSuspected = false } = message;\n  const variants = requestedVariants.slice(0, MAX_VARIANTS_PER_REGION);",
  'variant count cap',
);
await writeFile(preprocessPath, preprocess, 'utf8');

const progressUiPath = 'dist/performance-v22-ui.js';
let progressUi = await readFile(progressUiPath, 'utf8');
const hasGlobalCancel = progressUi.includes('RipScanLegacyOCR?.cancel?.()')
  && progressUi.includes('RipScanPerformanceRuntime?.cancelAll?.(');
if (!hasGlobalCancel) {
  progressUi = replaceRequired(
    progressUi,
    '      Promise.resolve(window.RipScanBookOCR?.cancel?.()),',
    "      Promise.allSettled([window.RipScanBookOCR?.cancel?.(), window.RipScanLegacyOCR?.cancel?.(), window.RipScanPerformanceRuntime?.cancelAll?.('USER_CANCELLED')]),",
    'global cancel propagation',
  );
}
await writeFile(progressUiPath, progressUi, 'utf8');

const indexPath = 'dist/index.html';
let indexHtml = await readFile(indexPath, 'utf8');
indexHtml = indexHtml.replace('  <script src="https://cdn.jsdelivr.net/npm/tesseract.js@7/dist/tesseract.min.js"></script>\n', '');
if (!indexHtml.includes('src="/performance-guard.js"')) {
  indexHtml = replaceRequired(indexHtml, '  <script type="module" src="/app.js"></script>', '  <script type="module" src="/performance-guard.js"></script>\n  <script type="module" src="/app.js"></script>', 'performance guard entry');
}
await writeFile(indexPath, indexHtml, 'utf8');

const serviceWorkerPath = 'dist/sw.js';
let serviceWorker = await readFile(serviceWorkerPath, 'utf8');
serviceWorker = serviceWorker.replace(/ripscan-pwa-v[0-9.]+/g, 'ripscan-pwa-v4.1.0');
for (const asset of ['/performance-runtime.mjs', '/performance-guard.js', '/lazy-libraries.mjs', '/book-ocr-browser-emergency.mjs']) {
  if (!serviceWorker.includes(`'${asset}'`)) serviceWorker = serviceWorker.replace("  '/app.js',", `  '/app.js',\n  '${asset}',`);
}
for (const heavy of ['/book-ocr-browser-performance.mjs', '/ocr-preprocess-worker.js', '/pdf-worker.js', '/office-import.mjs']) {
  serviceWorker = serviceWorker.replace(`  '${heavy}',\n`, '');
}
await writeFile(serviceWorkerPath, serviceWorker, 'utf8');

console.log('RipScan emergency performance build v4.1.0: lazy OCR/PDF libraries, bounded OCR queue, Safe Mode, virtual page DOM, debounced history, cancellation and cleanup');
