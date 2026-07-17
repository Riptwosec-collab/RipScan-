import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('emergency OCR wrapper lazy-loads Tesseract and uses shared bounded scheduler', async () => {
  const source = await read('web/book-ocr-browser-emergency.mjs');
  for (const required of [
    "loadTesseract()", "scheduler().schedule('heavy'", 'timeoutMs: 65_000',
    'maxVariantsPerRegion: safeMode ? 2 : 4', 'scheduler().cancel', 'RipScanBookOCR',
  ]) assert.ok(source.includes(required), `missing emergency OCR guard ${required}`);
});

test('performance guard detects long tasks safe mode duplicate jobs and cleanup', async () => {
  const source = await read('web/performance-guard.js');
  for (const required of [
    'LongTaskGuard', 'thresholdMs: 1000', "enterSafeMode('main_thread_long_task'",
    'ripscan:duplicate-job-blocked', 'resources.cleanupJob', 'resources.cleanup()',
    "cancelAll('DOCUMENT_CLOSED')", 'pagehide',
  ]) assert.ok(source.includes(required), `missing freeze guard ${required}`);
});

test('production patch removes eager OCR and PDF loading and delegates OCR to workers', async () => {
  const build = await read('build-performance.mjs');
  for (const required of [
    'lazy PDF.js import', 'lazy Tesseract loading', 'worker OCR delegation',
    'bounded region queue', 'page DOM virtualization', 'debounced editor history',
    'duplicate-safe cancellable run handler', 'MAX_VARIANTS_PER_REGION = 4',
    'MAX_VARIANT_PIXELS = 16_000_000', 'ripscan-pwa-v4.1.0',
  ]) assert.ok(build.includes(required), `missing performance build patch ${required}`);
  assert.ok(build.includes('indexHtml.replace(\'  <script src="https://cdn.jsdelivr.net/npm/tesseract.js@7/dist/tesseract.min.js"></script>\\n\', \'\')'));
});

test('precomputed worker blocks are reused instead of automatically OCRing the same page twice', async () => {
  const build = await read('build-performance-review.mjs');
  for (const required of [
    '__ripscanPrecomputedPageResults', 'workerProcessed: true', 'reuse precomputed OCR review',
    "if (pageCard.dataset.workerOcr === 'true') return", 'lazy manual retry OCR',
  ]) assert.ok(build.includes(required), `missing duplicate OCR prevention ${required}`);
});

test('safe mode thresholds match the emergency specification', async () => {
  const runtime = await read('web/performance-runtime.mjs');
  for (const required of [
    'safeFileBytes: 20 * 1024 * 1024', 'safePageCount: 20', 'safeRegionCount: 100',
    'safeCellCount: 500', 'safeImageSide: 4000', 'safeQueueLength: 40',
    'heavyConcurrency: Math.max(1, Math.min(safeMode ? 1 : 2',
    'historyLimit: Math.max(10, Math.min(80', 'previewMaxSide: safeMode ? 1400 : 2200',
  ]) assert.ok(runtime.includes(required), `missing safe mode rule ${required}`);
});

test('preprocess source still runs in OffscreenCanvas worker and production adds hard caps', async () => {
  const worker = await read('web/ocr-preprocess-worker.js');
  const build = await read('build-performance.mjs');
  assert.ok(worker.includes('OffscreenCanvas'));
  assert.ok(worker.includes("message.type === 'preprocess'"));
  assert.ok(worker.includes("message.type === 'cancel'"));
  assert.ok(build.includes('MAX_VARIANTS_PER_REGION = 4'));
  assert.ok(build.includes('MAX_VARIANT_PIXELS = 16_000_000'));
});

test('service worker performance build excludes heavy on-demand modules from precache', async () => {
  const build = await read('build-performance.mjs');
  for (const asset of [
    '/book-ocr-browser-performance.mjs', '/ocr-preprocess-worker.js', '/pdf-worker.js', '/office-import.mjs',
  ]) assert.ok(build.includes(asset), `missing lazy cache exclusion ${asset}`);
  for (const asset of [
    '/performance-runtime.mjs', '/performance-guard.js', '/lazy-libraries.mjs', '/book-ocr-browser-emergency.mjs',
  ]) assert.ok(build.includes(asset), `missing performance shell asset ${asset}`);
});
