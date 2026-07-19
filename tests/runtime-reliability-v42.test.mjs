import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('lazy OCR, PDF, and ZIP runtimes use deployed vendor files with a bounded load time', async () => {
  const source = await read('web/lazy-libraries.mjs');
  for (const asset of ['/vendor/tesseract.min.js', '/vendor/pdf.min.mjs', '/vendor/pdf.worker.min.mjs', '/vendor/jszip.min.js']) {
    assert.ok(source.includes(asset), `missing local runtime ${asset}`);
  }
  assert.match(source, /LOAD_TIMEOUT/u);
  assert.match(source, /LIBRARY_TIMEOUT_MS = 15_000/u);
});

test('export loads ZIP itself and limits canvas size before rendering', async () => {
  const source = await read('web/editor-export.mjs');
  assert.match(source, /loadJsZip/u);
  assert.match(source, /zip = false/u);
  assert.match(source, /ensureStudioLibraries\(\{ zip: true \}\)/u);
  assert.match(source, /MAX_EXPORT_PIXELS = 16_000_000/u);
  assert.match(source, /LOAD_TIMEOUT/u);
  for (const asset of ['/vendor/xlsx.full.min.js', '/vendor/html2canvas.min.js', '/vendor/jspdf.umd.min.js']) {
    assert.ok(source.includes(asset), `missing local export runtime ${asset}`);
  }
});

test('OCR worker startup has a timeout and terminates a late worker', async () => {
  const source = await read('web/book-ocr-browser-performance.mjs');
  assert.match(source, /workerPromise/u);
  assert.match(source, /25_000/u);
  assert.match(source, /if \(timedOut\) worker\.terminate/u);
});
