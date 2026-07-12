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

const indexPath = 'dist/index.html';
let indexHtml = await readFile(indexPath, 'utf8');
for (const [after, asset] of [
  ['/compact-home.css', '/layout-cover.css'],
  ['/layout-cover.css', '/reference-scale.css'],
  ['/reference-scale.css', '/cover-recovery.css'],
  ['/cover-recovery.css', '/performance-v22.css'],
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
    '        </h1>\n        <p class="hero-support">อัปโหลดไฟล์ PDF, PNG, JPG หรือวางจากคลิปบอร์ด ตั้งค่าการประมวลผล OCR แล้วแปลงเป็นข้อความที่ตรวจแก้ได้ทันที</p>\n      </div>',
  );
}
const scripts = [
  '/book-ocr-ui.js',
  '/cover-ocr-ui.js',
  '/cover-recovery-ui.js',
  '/performance-v22-ui.js',
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
serviceWorker = serviceWorker.replace(/ripscan-pwa-v[0-9.]+/g, 'ripscan-pwa-v2.2.0');
const assets = [
  '/layout-cover.css',
  '/reference-scale.css',
  '/cover-recovery.css',
  '/performance-v22.css',
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
];
for (const asset of assets) {
  if (!serviceWorker.includes(`'${asset}'`)) {
    serviceWorker = serviceWorker.replace("  '/compact-home.css',", `  '/compact-home.css',\n  '${asset}',`);
  }
}
await writeFile(serviceWorkerPath, serviceWorker, 'utf8');

console.log('RipScan static site built with OCR Worker Queue v2.2, progressive region retry, Cover Image Hard Block, Broken Sara Am recovery, and reference-scale layout');
