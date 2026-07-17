import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await cp('web', 'dist', { recursive: true });
await mkdir('dist/vendor', { recursive: true });
for (const [source, destination] of [
  ['node_modules/tesseract.js/dist/tesseract.min.js', 'tesseract.min.js'],
  ['node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
  ['node_modules/jszip/dist/jszip.min.js', 'jszip.min.js'],
  ['node_modules/pdfjs-dist/build/pdf.min.mjs', 'pdf.min.mjs'],
  ['node_modules/pdfjs-dist/build/pdf.worker.min.mjs', 'pdf.worker.min.mjs'],
  ['node_modules/@e965/xlsx/dist/xlsx.full.min.js', 'xlsx.full.min.js'],
  ['node_modules/html2canvas/dist/html2canvas.min.js', 'html2canvas.min.js'],
  ['node_modules/jspdf/dist/jspdf.umd.min.js', 'jspdf.umd.min.js'],
]) await cp(source, `dist/vendor/${destination}`);

const vendorReplacements = new Map([
  ['https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js', '/vendor/tesseract.min.js'],
  ['https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/worker.min.js', '/vendor/worker.min.js'],
  ['https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0/tesseract-core-lstm.wasm.js', '/vendor/tesseract-core-lstm.wasm.js'],
  ['https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js', '/vendor/jszip.min.js'],
  ['https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs', '/vendor/pdf.min.mjs'],
  ['https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs', '/vendor/pdf.worker.min.mjs'],
  ['https://cdn.jsdelivr.net/npm/@e965/xlsx@0.20.3/dist/xlsx.full.min.js', '/vendor/xlsx.full.min.js'],
  ['https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js', '/vendor/html2canvas.min.js'],
  ['https://cdn.jsdelivr.net/npm/jspdf@4.2.1/dist/jspdf.umd.min.js', '/vendor/jspdf.umd.min.js'],
]);
for (const path of ['dist/index.html', 'dist/app.js', 'dist/document-studio.js', 'dist/editor-export.mjs']) {
  let source = await readFile(path, 'utf8');
  for (const [remote, local] of vendorReplacements) source = source.replaceAll(remote, local);
  await writeFile(path, source, 'utf8');
}

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
// The source may use CRLF (or already contain the guarded implementation from
// a previous production merge).  Keep this build transform repeatable so a
// safe source never fails a release merely because there is nothing left to
// replace.
if (pdfToolsUi.includes(unsafeObserver)) {
  pdfToolsUi = pdfToolsUi.replace(unsafeObserver, safeObserver);
} else {
  const unsafeObserverPattern = /const observer = new MutationObserver\(\(\) => \{\r?\n  ensureUi\(\);\r?\n  installAnnotationTools\(\);\r?\n  refreshRoundTripSource\(\);\r?\n\}\);\r?\nobserver\.observe\(document\.documentElement, \{ childList: true, subtree: true \}\);\r?\nensureUi\(\);\r?\ninstallAnnotationTools\(\);\r?\ndocument\.documentElement\.dataset\.pdfToolsVersion = VERSION;/;
  if (unsafeObserverPattern.test(pdfToolsUi)) {
    pdfToolsUi = pdfToolsUi.replace(unsafeObserverPattern, safeObserver);
  } else if (!pdfToolsUi.includes('function initializePdfTools()')) {
    throw new Error('PDF Tools observer runtime guard could not be applied');
  }
}
await writeFile(pdfToolsUiPath, pdfToolsUi, 'utf8');

const indexPath = 'dist/index.html';
let indexHtml = await readFile(indexPath, 'utf8');
for (const [after, asset] of [
  ['/compact-home.css', '/layout-cover.css'],
  ['/layout-cover.css', '/reference-scale.css'],
  ['/reference-scale.css', '/cover-recovery.css'],
  ['/cover-recovery.css', '/performance-v22.css'],
  ['/performance-v22.css', '/table-auto.css'],
  ['/table-auto.css', '/document-studio.css'],
  ['/document-studio.css', '/table-review-v31.css'],
  ['/table-review-v31.css', '/quality-center.css'],
]) {
  if (!indexHtml.includes(`href="${asset}"`)) {
    indexHtml = indexHtml.replace(
      `<link rel="stylesheet" href="${after}">`,
      `<link rel="stylesheet" href="${after}">\n  <link rel="stylesheet" href="${asset}">`,
    );
  }
}
if (!indexHtml.includes('class="hero-support"')) {
  indexHtml = indexHtml.replace(
    '        </h1>\n      </div>',
    '        </h1>\n        <p class="hero-support">อัปโหลด PDF รูปภาพ Word Excel PowerPoint และไฟล์เอกสาร แล้วเปิดแก้ไขโครงสร้าง ตาราง และเลย์เอาต์ต่อได้ใน Document Studio</p>\n      </div>',
  );
}
const scripts = [
  '/book-ocr-ui.js',
  '/cover-ocr-ui.js',
  '/cover-recovery-ui.js',
  '/performance-v22-ui.js',
  '/table-auto-ui.js',
  '/pdf-tools-ui.js',
  '/document-studio.js',
  '/project-workspace.js',
  '/table-review-v31.js',
  '/quality-center.js',
];
for (const script of scripts) {
  if (!indexHtml.includes(`src="${script}"`)) {
    indexHtml = indexHtml.replace(
      '  <script type="module" src="/theme-ui.js"></script>',
      `  <script type="module" src="/theme-ui.js"></script>\n  <script type="module" src="${script}"></script>`,
    );
  }
}
await writeFile(indexPath, indexHtml, 'utf8');

const coverUiPath = 'dist/cover-ocr-ui.js';
let coverUi = await readFile(coverUiPath, 'utf8');
coverUi = coverUi.replace(
  "from './cover-ocr-core.mjs';",
  "from './cover-ocr-rules.mjs';",
);
coverUi = coverUi.replaceAll("'manual_review'", "'review_required'");
coverUi = coverUi.replaceAll("'accepted'", "'verified'");
coverUi = coverUi.replaceAll("'rejected_as_non_text'", "'confirmed_non_text'");
coverUi = coverUi.replace(
  '  const grayscale = grayscaleCanvas(up4);',
  "  const cropUrl = original.toDataURL('image/jpeg', .88);\n  const enhancedUrl = up4.toDataURL('image/jpeg', .88);\n  const grayscale = grayscaleCanvas(up4);",
);
coverUi = coverUi.replace(
  "  region.cropUrl = original.toDataURL?.('image/jpeg', .88) || '';\n  region.enhancedUrl = up4.toDataURL?.('image/jpeg', .88) || '';",
  '  region.cropUrl = cropUrl;\n  region.enhancedUrl = enhancedUrl;',
);
coverUi = coverUi.replace(
  "    if (button) button.textContent = 'วาดกรอบข้อความ';\n    renderRegionList(panel, pageCard);\n  });\n}",
  "    if (button) button.textContent = 'วาดกรอบข้อความ';\n    renderRegionList(panel, pageCard);\n    const created = state.regions.find(item => item.id === state.activeRegionId);\n    if (created) recognizeRegion(panel, pageCard, created).catch(error => { created.status = 'review_required'; created.reason = error.message || 'อ่านกรอบไม่สำเร็จ'; renderRegionList(panel, pageCard); });\n  });\n}",
);
await writeFile(coverUiPath, coverUi, 'utf8');

const serviceWorkerPath = 'dist/sw.js';
let serviceWorker = await readFile(serviceWorkerPath, 'utf8');
for (const [remote, local] of vendorReplacements) serviceWorker = serviceWorker.replaceAll(remote, local);
serviceWorker = serviceWorker.replace(/ripscan-pwa-v[0-9.]+/g, 'ripscan-pwa-v4.0.1');
const assets = [
  '/layout-cover.css',
  '/reference-scale.css',
  '/cover-recovery.css',
  '/performance-v22.css',
  '/table-auto.css',
  '/document-studio.css',
  '/pdf-tools.css',
  '/table-review-v31.css',
  '/cover-ocr-core.mjs',
  '/cover-ocr-rules.mjs',
  '/cover-recovery-core.mjs',
  '/cover-hard-block.mjs',
  '/cover-ocr-ui.js',
  '/cover-recovery-ui.js',
  '/book-ocr-core.mjs',
  '/book-ocr-rules.mjs',
  '/book-ocr-browser.mjs',
  '/book-ocr-browser-recovery.mjs',
  '/book-ocr-browser-hard-block.mjs',
  '/book-ocr-browser-performance.mjs',
  '/book-ocr-ui.js',
  '/sara-am-spacing.mjs',
  '/sara-am-recovery-v21.mjs',
  '/ocr-performance-core.mjs',
  '/ocr-preprocess-worker.js',
  '/performance-v22-ui.js',
  '/table-structure-core.mjs',
  '/table-auto-ui.js',
  '/table-reconstruction-core.mjs',
  '/table-reconstruction-worker.js',
  '/table-review-v312.js',
  '/document-model.mjs',
  '/office-import.mjs',
  '/editor-export.mjs',
  '/document-studio.js',
  '/pdf-utility-core.mjs',
  '/pdf-page-organizer.mjs',
  '/pdf-worker.js',
  '/pdf-tool-runtime.mjs',
  '/ripscan-project.mjs',
  '/roundtrip-export.mjs',
  '/pdf-tools-ui.js',
  '/quality-core.mjs',
  '/quality-center.js',
  '/quality-center.css',
  '/project-core.mjs',
  '/project-workspace.js',
  '/fonts/NotoSansThai.ttf',
  '/vendor/tesseract.min.js',
  '/vendor/worker.min.js',
  '/vendor/tesseract-core-lstm.wasm.js',
  '/vendor/jszip.min.js',
  '/vendor/pdf.min.mjs',
  '/vendor/pdf.worker.min.mjs',
  '/vendor/xlsx.full.min.js',
  '/vendor/html2canvas.min.js',
  '/vendor/jspdf.umd.min.js',
];
for (const asset of assets) {
  if (!serviceWorker.includes(`'${asset}'`)) {
    serviceWorker = serviceWorker.replace("  '/compact-home.css',", `  '/compact-home.css',\n  '${asset}',`);
  }
}
await writeFile(serviceWorkerPath, serviceWorker, 'utf8');

console.log('RipScan PDF Tools v4.0.1 runtime guard, same-origin OCR runtime dependencies, Table-first Reconstruction v3.1, and Document Reconstruction Studio production bundle built');
