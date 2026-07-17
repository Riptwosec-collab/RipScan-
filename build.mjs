import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await cp('web', 'dist', { recursive: true });

const browserModulePath = 'dist/book-ocr-browser.mjs';
const browserModule = await readFile(browserModulePath, 'utf8');
const strictBrowserModule = browserModule.replace(
  "from './book-ocr-core.mjs';",
  "from './book-ocr-rules.mjs';",
);
if (strictBrowserModule === browserModule) throw new Error('Strict book OCR rules were not applied to the production module');
await writeFile(browserModulePath, strictBrowserModule, 'utf8');

const bookUiPath = 'dist/book-ocr-ui.js';
let bookUi = await readFile(bookUiPath, 'utf8');
bookUi = bookUi.replace(
  "from './book-ocr-browser.mjs';",
  "from './book-ocr-browser-performance.mjs';",
);
bookUi = bookUi.replace(
  '    pageResults.set(pageCard, result);',
  "    pageResults.set(pageCard, result);\n    window.__ripscanBookResults ||= new WeakMap();\n    window.__ripscanBookResults.set(pageCard, result);\n    pageCard.dispatchEvent(new CustomEvent('ripscan:book-result', { bubbles: true, detail: result }));",
);
bookUi = bookUi.replace(
  '      options: readControlOptions(document.querySelector(\'#bookOcrOptions\')),',
  "      options: { ...readControlOptions(document.querySelector('#bookOcrOptions')), performanceWorker: true },\n      pageNumber,",
);
bookUi = bookUi.replace(
  "      onProgress(message) {\n        if (token !== currentRunToken) return;\n        const percent = Math.round((message.progress || 0) * 100);\n        updateGlobalStatus(`หน้า ${pageNumber} · ${message.label || message.status} · ${percent}%`, true);\n      },",
  "      onProgress(message) {\n        if (token !== currentRunToken) return;\n        const percent = Math.round((message.progress || 0) * 100);\n        updateGlobalStatus(`หน้า ${pageNumber} · ${message.label || message.status} · ${percent}%`, true);\n      },\n      onBlockResult(block) {\n        if (token !== currentRunToken || !block?.text || block.doNotEmitTokens) return;\n        const pageText = pageCard.querySelector('.page-text');\n        const current = pageText?.value?.trim() || '';\n        const partial = block.status === 'verified' ? block.text : `[โปรดตรวจสอบ: ${block.text}]`;\n        if (pageText && !current.includes(block.text)) setPageText(pageCard, `${current}${current ? '\\n\\n' : ''}${partial}`);\n      },",
);
await writeFile(bookUiPath, bookUi, 'utf8');

const pdfToolsUiPath = 'dist/pdf-tools-ui.js';
let pdfToolsUi = await readFile(pdfToolsUiPath, 'utf8');
const unsafeObserver = `const observer = new MutationObserver(() => {
  ensureUi();
  installAnnotationTools();
  refreshRoundTripSource();
});
observer.observe(document.documentElement, { childList: true, subtree: true });
ensureUi();
installAnnotationTools();
document.documentElement.dataset.pdfToolsVersion = VERSION;`;
const safeObserver = `function initializePdfTools() {
  const ready = ensureUi() || Boolean(document.querySelector('#pdfToolsSection'));
  installAnnotationTools();
  refreshRoundTripSource();
  return ready;
}

const observer = new MutationObserver(() => {
  if (initializePdfTools()) observer.disconnect();
});
observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
if (initializePdfTools()) observer.disconnect();
document.addEventListener('click', event => {
  if (event.target.closest('#convertCenterButton,[data-studio-action="convert"]')) queueMicrotask(refreshRoundTripSource);
}, true);
document.documentElement.dataset.pdfToolsVersion = VERSION;`;
if (!pdfToolsUi.includes(unsafeObserver)) throw new Error('PDF Tools observer runtime guard could not be applied');
pdfToolsUi = pdfToolsUi.replace(unsafeObserver, safeObserver);
await writeFile(pdfToolsUiPath, pdfToolsUi, 'utf8');

const appPath = 'dist/app.js';
let appJs = await readFile(appPath, 'utf8');
const staticPdfImport = `import * as pdfjsLib from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';`;
const lazyPdfImport = `let pdfjsPromise = null;
async function ensurePdfJs() {
  if (!pdfjsPromise) pdfjsPromise = import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs').then(module => {
    module.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
    return module;
  });
  return pdfjsPromise;
}`;
if (!appJs.includes(staticPdfImport)) throw new Error('Static PDF.js import could not be converted to dynamic import');
appJs = appJs.replace(staticPdfImport, lazyPdfImport);
appJs = appJs.replace('const MAX_CANVAS_SIDE = 2800;', "const MAX_CANVAS_SIDE = globalThis.RipScanPerformance?.largeFileMode?.enabled ? 1700 : 2400;");
appJs = appJs.replace(
  "  if (!window.Tesseract?.createWorker) throw new Error('โหลดระบบ OCR ไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตแล้วรีเฟรชหน้า');",
  "  if (!window.Tesseract?.createWorker) await globalThis.RipScanPerformance?.loadTesseract?.();\n  if (!window.Tesseract?.createWorker) throw new Error('โหลดระบบ OCR ไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตแล้วรีเฟรชหน้า');",
);
appJs = appJs.replace(
  '  const loadingTask = pdfjsLib.getDocument({ data });',
  '  const pdfjsLib = await ensurePdfJs();\n  const loadingTask = pdfjsLib.getDocument({ data });',
);
appJs = appJs.replace(
  '  const scale = Math.min(2.25, MAX_CANVAS_SIDE / Math.max(1, baseViewport.width, baseViewport.height));',
  "  const previewScale = globalThis.RipScanPerformance?.largeFileMode?.enabled ? 1.15 : 1.8;\n  const scale = Math.min(previewScale, MAX_CANVAS_SIDE / Math.max(1, baseViewport.width, baseViewport.height));",
);
const optimizedRecognition = `async function recognizeWithAutoEnhancement(sourceCanvas, label) {
  statusText.textContent = \`${'${label}'} · เตรียมภาพใน Worker\`;
  const { preprocessOcrVariants } = await import('./performance-image-client.mjs');
  const base = await preprocessOcrVariants(sourceCanvas, { mode: 'base', timeoutMs: 15_000 });
  const recognized = [];
  for (const variant of base.variants.slice(0, 2)) {
    recognized.push({ ...await recognizeCanvas(variant.blob, label, variant.name), blob: variant.blob });
    await globalThis.RipScanPerformance?.yieldToMain?.();
  }
  let currentBest = [...recognized].sort((a, b) => scoreOcrResult(b) - scoreOcrResult(a))[0];
  if (currentBest.confidence < .88 || currentBest.text.replace(/\\s/gu, '').length < 40) {
    const retry = await preprocessOcrVariants(sourceCanvas, { mode: 'threshold', timeoutMs: 15_000, priority: 80 });
    for (const variant of retry.variants.slice(0, 1)) recognized.push({ ...await recognizeCanvas(variant.blob, label, variant.name), blob: variant.blob });
    currentBest = [...recognized].sort((a, b) => scoreOcrResult(b) - scoreOcrResult(a))[0];
  }
  const enhancedPreviewUrl = URL.createObjectURL(currentBest.blob);
  state.objectUrls.add(enhancedPreviewUrl);
  return {
    text: currentBest.text,
    confidence: currentBest.confidence,
    source: 'ocr-browser-worker',
    bestVariant: currentBest.variant,
    deskewAngle: base.deskewAngle,
    enhancedPreviewUrl,
    attempts: recognized.map(item => ({ name: item.variant, confidence: item.confidence })),
  };
}`;
const recognitionPattern = /async function recognizeWithAutoEnhancement\(sourceCanvas, label\) \{[\s\S]*?\n\}\n\nasync function processImage/u;
if (!recognitionPattern.test(appJs)) throw new Error('OCR preprocessing function could not be moved to Worker');
appJs = appJs.replace(recognitionPattern, `${optimizedRecognition}\n\nasync function processImage`);
appJs = appJs.replaceAll('      page.cleanup();\n', '      page.cleanup();\n      await globalThis.RipScanPerformance?.yieldToMain?.();\n');
await writeFile(appPath, appJs, 'utf8');

const studioPath = 'dist/document-studio.js';
let studio = await readFile(studioPath, 'utf8');
studio = studio.replace(
  "} from './editor-export.mjs';",
  "} from './editor-export.mjs';\nimport { DocumentPatchHistory } from './document-patch-history.mjs';",
);
studio = studio.replace('const MAX_HISTORY = 50;', "const MAX_HISTORY = globalThis.RipScanPerformance?.largeFileMode?.historyLimit || globalThis.RipScanPerformance?.config?.historyLimit || 70;\nconst patchHistory = new DocumentPatchHistory({ limit: MAX_HISTORY });");
studio = studio.replace('  dirty: false,\n};', '  dirty: false,\n  pendingSnapshot: null,\n  applyingHistory: false,\n};');
const historyPattern = /function snapshot\(label = 'แก้ไข'\) \{[\s\S]*?function updateHistoryButtons\(\) \{[\s\S]*?\n\}/u;
const patchHistoryFunctions = `function snapshot(label = 'แก้ไข') {
  if (!state.model || state.pendingSnapshot || state.applyingHistory) return;
  state.pendingSnapshot = { label, model: cloneValue(state.model), activePage: state.activePage, selectedBlockId: state.selectedBlockId };
  state.dirty = true;
}

function commitPendingSnapshot(groupKey = '') {
  const pending = state.pendingSnapshot;
  if (!pending || !state.model || state.applyingHistory) return;
  state.pendingSnapshot = null;
  patchHistory.record(pending.model, state.model, { label: pending.label, groupKey });
  state.dirty = true;
  updateHistoryButtons();
}

function undo() {
  commitPendingSnapshot();
  if (!patchHistory.canUndo || !state.model) return;
  state.applyingHistory = true;
  const result = patchHistory.undo(state.model);
  state.model = normalizeDocumentModel(result.model);
  state.selectedCellIds.clear();
  state.dirty = true;
  state.applyingHistory = false;
  renderStudio();
}

function redo() {
  commitPendingSnapshot();
  if (!patchHistory.canRedo || !state.model) return;
  state.applyingHistory = true;
  const result = patchHistory.redo(state.model);
  state.model = normalizeDocumentModel(result.model);
  state.selectedCellIds.clear();
  state.dirty = true;
  state.applyingHistory = false;
  renderStudio();
}

function updateHistoryButtons() {
  const undoButton = $('[data-studio-action="undo"]');
  const redoButton = $('[data-studio-action="redo"]');
  if (undoButton) undoButton.disabled = !patchHistory.canUndo;
  if (redoButton) redoButton.disabled = !patchHistory.canRedo;
}`;
if (!historyPattern.test(studio)) throw new Error('Document Studio snapshot history could not be converted to patch history');
studio = studio.replace(historyPattern, patchHistoryFunctions);
studio = studio.replace(
  "    if (event.target.matches('[contenteditable=\"true\"]') && state.model) state.editingSnapshot = cloneValue(state.model);",
  "    if (event.target.matches('[contenteditable=\"true\"]') && state.model) snapshot('แก้ข้อความ');",
);
const focusOutPattern = /  shell\.addEventListener\('focusout',[\s\S]*?\n  \}\);/u;
studio = studio.replace(focusOutPattern, `  shell.addEventListener('focusout', event => {
    if (!event.target.matches('[contenteditable="true"]') || !state.model) return;
    const key = event.target.dataset.textContent || event.target.dataset.tableCell || event.target.dataset.fieldContent || 'editor';
    commitPendingSnapshot(\`continuous-edit:${'${key}'}\`);
  });`);
studio = studio.replace('function renderStudio() {\n  if (!state.model', 'function renderStudio() {\n  if (!state.applyingHistory) commitPendingSnapshot();\n  if (!state.model');
studio = studio.replace('  state.history = [];\n  state.future = [];', '  state.history = [];\n  state.future = [];\n  state.pendingSnapshot = null;\n  patchHistory.clear();');
studio = studio.replace(
  "  $('#documentStudio').hidden = true;\n  document.body.classList.remove('studio-open');",
  "  $('#documentStudio').hidden = true;\n  document.body.classList.remove('studio-open');\n  state.pendingSnapshot = null;\n  patchHistory.clear();\n  globalThis.RipScanPerformance?.cleanupDocumentResources?.(state.model?.id || 'studio');",
);
studio = studio.replace('function renderExportPages() {\n  const stage = $(\'#studioExportStage\');\n  stage.innerHTML = state.model.pages.map(page => renderPageElement(page, { exportMode: true })).join(\'\');', "function renderExportPages(selectedPages = state.model.pages.map((_, index) => index)) {\n  const stage = $('#studioExportStage');\n  stage.innerHTML = selectedPages.map(index => state.model.pages[index]).filter(Boolean).map(page => renderPageElement(page, { exportMode: true })).join('');");
studio = studio.replace('    const elements = renderExportPages();', '    const elements = renderExportPages(options.selectedPages);');
studio = studio.replace('      const viewport = source.getViewport({ scale: 1.35 });', "      const studioScale = globalThis.RipScanPerformance?.largeFileMode?.enabled ? .82 : 1.2;\n      const viewport = source.getViewport({ scale: studioScale });");
await writeFile(studioPath, studio, 'utf8');

const indexPath = 'dist/index.html';
let indexHtml = await readFile(indexPath, 'utf8');
indexHtml = indexHtml
  .replace('  <script src="https://cdn.jsdelivr.net/npm/tesseract.js@7/dist/tesseract.min.js"></script>\n', '')
  .replace('  <script src="https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js"></script>\n', '');
for (const [after, asset] of [
  ['/compact-home.css', '/layout-cover.css'],
  ['/layout-cover.css', '/reference-scale.css'],
  ['/reference-scale.css', '/performance-v5.css'],
]) {
  if (!indexHtml.includes(`href="${asset}"`)) indexHtml = indexHtml.replace(`<link rel="stylesheet" href="${after}">`, `<link rel="stylesheet" href="${after}">\n  <link rel="stylesheet" href="${asset}">`);
}
if (!indexHtml.includes('class="hero-support"')) {
  indexHtml = indexHtml.replace('        </h1>\n      </div>', '        </h1>\n        <p class="hero-support">อัปโหลด PDF รูปภาพ Word Excel PowerPoint และไฟล์เอกสาร แล้วเปิดแก้ไขโครงสร้าง ตาราง และเลย์เอาต์ต่อได้ใน Document Studio</p>\n      </div>');
}
if (!indexHtml.includes('src="/performance-bootstrap.js"')) {
  indexHtml = indexHtml.replace('  <script type="module" src="/app.js"></script>', '  <script type="module" src="/performance-bootstrap.js"></script>\n  <script type="module" src="/studio-virtualization.mjs"></script>\n  <script type="module" src="/app.js"></script>');
}
const lazyScripts = [
  '/book-ocr-ui.js',
  '/cover-ocr-ui.js',
  '/cover-recovery-ui.js',
  '/performance-v22-ui.js',
  '/table-auto-ui.js',
  '/pdf-tools-ui.js',
  '/document-studio.js',
  '/table-review-v312.js',
];
for (const script of lazyScripts) indexHtml = indexHtml.replace(new RegExp(`\\s*<script type="module" src="${script.replaceAll('/', '\\/')}"?><\\/script>`, 'gu'), '');
await writeFile(indexPath, indexHtml, 'utf8');

const coverUiPath = 'dist/cover-ocr-ui.js';
let coverUi = await readFile(coverUiPath, 'utf8');
coverUi = coverUi.replace("from './cover-ocr-core.mjs';", "from './cover-ocr-rules.mjs';");
coverUi = coverUi.replaceAll("'manual_review'", "'review_required'");
coverUi = coverUi.replaceAll("'accepted'", "'verified'");
coverUi = coverUi.replaceAll("'rejected_as_non_text'", "'confirmed_non_text'");
coverUi = coverUi.replace('  const grayscale = grayscaleCanvas(up4);', "  const cropUrl = original.toDataURL('image/jpeg', .88);\n  const enhancedUrl = up4.toDataURL('image/jpeg', .88);\n  const grayscale = grayscaleCanvas(up4);");
coverUi = coverUi.replace("  region.cropUrl = original.toDataURL?.('image/jpeg', .88) || '';\n  region.enhancedUrl = up4.toDataURL?.('image/jpeg', .88) || '';", '  region.cropUrl = cropUrl;\n  region.enhancedUrl = enhancedUrl;');
coverUi = coverUi.replace("    if (button) button.textContent = 'วาดกรอบข้อความ';\n    renderRegionList(panel, pageCard);\n  });\n}", "    if (button) button.textContent = 'วาดกรอบข้อความ';\n    renderRegionList(panel, pageCard);\n    const created = state.regions.find(item => item.id === state.activeRegionId);\n    if (created) recognizeRegion(panel, pageCard, created).catch(error => { created.status = 'review_required'; created.reason = error.message || 'อ่านกรอบไม่สำเร็จ'; renderRegionList(panel, pageCard); });\n  });\n}");
await writeFile(coverUiPath, coverUi, 'utf8');

const serviceWorkerPath = 'dist/sw.js';
let serviceWorker = await readFile(serviceWorkerPath, 'utf8');
serviceWorker = serviceWorker.replace(/ripscan-pwa-v[0-9.]+/gu, 'ripscan-pwa-v5.0.0');
await writeFile(serviceWorkerPath, serviceWorker, 'utf8');

const deferredStyles = ['/cover-recovery.css', '/performance-v22.css', '/table-auto.css', '/document-studio.css', '/pdf-tools.css', '/table-review-v31.css'];
const lazyAssets = [
  '/performance-runtime.mjs', '/performance-bootstrap.js', '/performance-image-worker.js', '/performance-image-client.mjs',
  '/document-patch-history.mjs', '/studio-virtualization.mjs', '/performance-v5.css',
  '/cover-ocr-core.mjs', '/cover-ocr-rules.mjs', '/cover-recovery-core.mjs', '/cover-hard-block.mjs',
  '/book-ocr-core.mjs', '/book-ocr-rules.mjs', '/book-ocr-browser-performance.mjs', '/sara-am-recovery-v21.mjs',
  '/ocr-performance-core.mjs', '/ocr-preprocess-worker.js', '/table-structure-core.mjs', '/table-reconstruction-core.mjs',
  '/table-reconstruction-worker.js', '/document-model.mjs', '/office-import.mjs', '/editor-export.mjs',
  '/pdf-utility-core.mjs', '/pdf-page-organizer.mjs', '/pdf-worker.js', '/pdf-tool-runtime.mjs', '/ripscan-project.mjs', '/roundtrip-export.mjs',
];
void deferredStyles;
void lazyAssets;

console.log('RipScan static site built with Performance Runtime v5.0.0, dynamic tool loading, OffscreenCanvas OCR preprocessing, patch-based Document Studio history, PDF and table virtualization, Large File Mode, PDF Tools v4.0.1 runtime guard, Table-first Reconstruction v3.1.2, OCR Worker Queue, Cover Image Hard Block, and Broken Sara Am recovery');
