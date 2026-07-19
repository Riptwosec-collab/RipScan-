import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = name => fs.readFileSync(new URL('../web/' + name, import.meta.url), 'utf8');

test('preprocess worker has timeout and abort handling', () => {
  const source = read('book-ocr-browser-performance.mjs');
  assert.match(source, /PREPROCESS_TIMEOUT/);
  assert.match(source, /throwIfAborted/);
});

test('tesseract worker emits heartbeat progress', () => {
  const source = read('book-ocr-browser-performance.mjs');
  assert.match(source, /worker_heartbeat/);
  assert.match(source, /workerHeartbeatLabel/);
});

test('worker timeout retries only once', () => {
  const source = read('book-ocr-browser-emergency.mjs');
  assert.match(source, /WORKER_AUTO_RETRY/);
  assert.match(source, /attempt < 2/);
});

test('watchdog distinguishes warning from timeout', () => {
  const source = read('performance-v22-ui.js');
  assert.match(source, /HARD_WATCHDOG_MS/);
  assert.match(source, /level: 'timeout'/);
});

test('cancel button cancels the active OCR pipeline', () => {
  const source = read('app.js');
  assert.match(source, /RipScanLegacyOCR\?\.cancel/);
});
