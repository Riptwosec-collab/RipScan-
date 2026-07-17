import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('production build wires OCR performance responsive table Studio PDF worker and PWA cache', async () => {
  const build = await read('build.mjs');
  for (const required of [
    'book-ocr-browser-performance.mjs',
    '/ocr-preprocess-worker.js',
    '/ocr-performance-core.mjs',
    '/performance-v22-ui.js',
    '/performance-v22.css',
    '/table-structure-core.mjs',
    '/table-auto-ui.js',
    '/table-auto.css',
    '/table-reconstruction-core.mjs',
    '/table-reconstruction-worker.js',
    '/table-review-v31.js',
    '/table-review-v31.css',
    '/document-studio.js',
    '/document-studio.css',
    'ripscan-pwa-v4.0.1',
  ]) assert.ok(build.includes(required), `missing ${required}`);
});

test('worker performs segmentation preprocessing and explicit memory disposal', async () => {
  const worker = await read('web/ocr-preprocess-worker.js');
  for (const required of [
    'OffscreenCanvas', "message.type === 'segment'", "message.type === 'preprocess'",
    "message.type === 'cancel'", "message.type === 'dispose'", 'convertToBlob',
    'image.data.fill(0)', 'releaseCanvas',
  ]) assert.ok(worker.includes(required), `missing ${required}`);
});

test('performance browser pipeline limits work and retries only regions', async () => {
  const browser = await read('web/book-ocr-browser-performance.mjs');
  for (const required of [
    'TesseractPool', 'PreprocessClient', 'Retry เฉพาะ Block', 'OCR_LIMITS.regionTimeoutMs',
    'OCR_LIMITS.retryTimeoutMs', 'stableRegionHash', 'cache.clear()', 'URL.revokeObjectURL',
    'ripscan:ocr-progress', 'retriesChargeCredits: false',
  ]) assert.ok(browser.includes(required), `missing ${required}`);
  assert.ok(!browser.includes('Upscale 6x'));
});

test('progress UI throttles updates and provides watchdog and cancel', async () => {
  const ui = await read('web/performance-v22-ui.js');
  assert.ok(ui.includes('THROTTLE_MS = 160'));
  assert.ok(ui.includes('WATCHDOG_MS = 10_000'));
  assert.ok(ui.includes('ยกเลิกการประมวลผล'));
  assert.ok(ui.includes('Promise.race'));
  assert.ok(ui.includes('1_900'));
});
