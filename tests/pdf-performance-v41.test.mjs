import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('PDF performance build serializes heavy tools through the shared scheduler', async () => {
  const build = await read('build-performance-pdf.mjs');
  for (const required of [
    "queueType = state.tool === 'edit' ? 'heavy' : 'export'",
    'RipScanPerformanceRuntime.scheduler.schedule', 'signal: state.controller.signal',
    "timeoutMs: queueType === 'export' ? 190_000 : 65_000",
    'lazy ZIP loading', 'canvas.width = 0', 'canvas.height = 0',
  ]) assert.ok(build.includes(required), `missing PDF performance guard ${required}`);
});

test('existing PDF runtime keeps worker timeout cancel transfer and dispose behavior', async () => {
  const runtime = await read('web/pdf-tool-runtime.mjs');
  for (const required of [
    "new Worker('/pdf-worker.js', { type: 'module' })", "this.worker.postMessage({ type: 'cancel'",
    'transfer: [bytes.buffer]', 'worker.dispose()', 'page.cleanup()', 'await pdf.destroy()',
  ]) assert.ok(runtime.includes(required), `missing PDF runtime behavior ${required}`);
});
