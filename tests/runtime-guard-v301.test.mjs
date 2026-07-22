import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('OCR runtime has bounded single-worker startup and recognition timeout', async () => {
  const [guard, index, build, serviceWorker, advanced, vendorBuild, bookUi, tableUi] = await Promise.all([
    read('web/ocr-runtime-guard.js'),
    read('web/index.html'),
    read('build.mjs'),
    read('web/sw.js'),
    read('web/advanced.js'),
    read('build-vendor-assets.mjs'),
    read('web/book-ocr-ui.js'),
    read('web/table-auto-ui.js'),
  ]);
  for (const required of [
    'WORKER_START_TIMEOUT_MS = 45_000',
    'RECOGNIZE_TIMEOUT_MS = 60_000',
    'workerBlobURL: false',
    "corePath: '/vendor/tesseract-core/tesseract-core-lstm.wasm.js'",
    "'OCR_WORKER_START_TIMEOUT'",
    "'OCR_RECOGNIZE_TIMEOUT'",
    'terminateLateWorker',
    "dataset.ocrRuntimeGuard = '3.0.2'",
  ]) assert.ok(guard.includes(required), `missing OCR guard contract: ${required}`);
  assert.match(index, /data-ripscan-tesseract/u);
  assert.match(index, /src="\/ocr-runtime-guard\.js"/u);
  assert.match(index, /src="\/vendor\/tesseract\.min\.js"/u);
  assert.doesNotMatch(index, /cdn\.jsdelivr\.net/u);
  assert.match(build, /ripscan-pwa-v3\.0\.2/u);
  assert.match(serviceWorker, /'\/ocr-runtime-guard\.js'/u);
  assert.match(advanced, /data-ripscan-tesseract/u);
  for (const asset of ['worker.min.js', 'tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm', 'tha.traineddata.gz', 'eng.traineddata.gz']) {
    assert.ok(vendorBuild.includes(asset), `missing local OCR asset: ${asset}`);
  }
  assert.match(bookUi, /const advancedMode = options\.mode !== 'text_only' \|\| options\.readTextOnImages/u);
  assert.match(tableUi, /readingMode !== 'table_only' && readingMode !== 'all'/u);
});

test('PDF and export libraries have bounded retryable loading', async () => {
  const [app, studio, exporter, upgrade, advanced, verified] = await Promise.all([
    read('web/app.js'),
    read('web/document-studio.js'),
    read('web/editor-export.mjs'),
    read('web/upgrade.js'),
    read('web/advanced.js'),
    read('web/verified.js'),
  ]);
  assert.doesNotMatch(app, /^import \* as pdfjsLib from 'https:/u);
  assert.match(app, /loadPdfJs\(\)/u);
  assert.match(app, /PDFJS_URL = '\/vendor\/pdf\.min\.mjs'/u);
  assert.match(app, /20_000/u);
  assert.match(studio, /loadPdfLibrary\(\)/u);
  assert.match(exporter, /scriptPromises\.delete\(src\)/u);
  assert.match(exporter, /โหลดระบบส่งออกนานเกิน 20 วินาที/u);
  assert.doesNotMatch(exporter, /cdn\.jsdelivr\.net/u);
  for (const source of [app, exporter, upgrade, advanced, verified]) {
    assert.match(source, /document\.body\.append\(/u, 'download links must be attached for Chrome and WebView');
  }
});
