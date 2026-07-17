import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('production build lazy-loads heavy tools and removes initial CDN engines', async () => {
  const build = await read('build.mjs');
  for (const required of [
    'performance-bootstrap.js', 'performance-runtime.mjs', 'performance-image-worker.js',
    'performance-image-client.mjs', 'document-patch-history.mjs', 'studio-virtualization.mjs',
    'Static PDF.js import could not be converted to dynamic import',
    "await globalThis.RipScanPerformance?.loadTesseract?.()",
    "import('./performance-image-client.mjs')",
    'ripscan-pwa-v5.0.0',
  ]) assert.ok(build.includes(required), `missing ${required}`);
  assert.ok(build.includes(".replace('  <script src=\"https://cdn.jsdelivr.net/npm/tesseract.js@7/dist/tesseract.min.js\"></script>\\n', '')"));
  assert.ok(build.includes(".replace('  <script src=\"https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js\"></script>\\n', '')"));
  assert.ok(!build.includes('const scripts = ['), 'heavy tools must not be injected as eager module scripts');
});

test('bootstrap performs tool-level dynamic imports and does not duplicate existing shells', async () => {
  const source = await read('web/performance-bootstrap.js');
  for (const required of [
    "import('./document-studio.js')", "import('./pdf-tools-ui.js')", "import('./table-review-v312.js')",
    "import('./book-ocr-ui.js')", 'loadTesseract', 'loadJsZip', 'requestIdleCallback',
    'ripscan-performance-mode', 'CLEAR_TEMPORARY_CACHE', 'largeFileMode', 'cleanupDocumentResources',
  ]) assert.ok(source.includes(required), `missing ${required}`);
  assert.ok(!source.includes("shell.id = 'documentStudio'"));
  assert.ok(!source.includes("dialog.id = 'convertCenter'"));
});

test('image preprocessing worker uses OffscreenCanvas transfer cancel and explicit release', async () => {
  const worker = await read('web/performance-image-worker.js');
  const client = await read('web/performance-image-client.mjs');
  for (const required of ['OffscreenCanvas', 'convertToBlob', "message.type === 'cancel'", "message.type === 'dispose'", 'canvas.width = 0', 'bitmap.close?.()', 'image.data.fill(0)']) assert.ok(worker.includes(required), `missing ${required}`);
  for (const required of ["new Worker('/performance-image-worker.js', { type: 'module' })", '[bitmap]', 'AbortError', 'timeoutMs', 'queue.enqueue']) assert.ok(client.includes(required), `missing ${required}`);
});

test('studio virtualization limits thumbnail and table windows', async () => {
  const source = await read('web/studio-virtualization.mjs');
  for (const required of ['PAGE_WINDOW = 16', 'TABLE_WINDOW = 56', 'studio-page-virtual-spacer', 'studio-table-virtual-scroll', 'requestAnimationFrame', 'loading="lazy"', 'decoding="async"']) assert.ok(source.includes(required), `missing ${required}`);
});

test('service worker precaches only shell and bounds runtime cache', async () => {
  const sw = await read('web/sw.js');
  assert.ok(sw.includes("const VERSION = 'ripscan-pwa-v5.0.0'"));
  assert.ok(sw.includes('RUNTIME_LIMIT = 48'));
  assert.ok(sw.includes('LAZY_LOCAL_ASSETS'));
  assert.ok(sw.includes('isUserOrGeneratedResource'));
  assert.ok(sw.includes("['blob:', 'data:', 'file:']"));
  assert.ok(sw.includes('trimCache'));
  const shellSection = sw.slice(sw.indexOf('const APP_SHELL'), sw.indexOf('const LAZY_LOCAL_ASSETS'));
  assert.ok(!shellSection.includes('/document-studio.js'));
  assert.ok(!shellSection.includes('/pdf-tools-ui.js'));
  assert.ok(!shellSection.includes('/book-ocr-ui.js'));
});
