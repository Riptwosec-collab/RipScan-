import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('local Tesseract runtime has bounded startup retry and activity heartbeat', async () => {
  const source = await read('web/lazy-libraries.mjs');
  for (const required of [
    "workerPath: '/vendor/worker.min.js'",
    "corePath: '/vendor/tesseract-core'",
    "langPath: '/vendor/tessdata'",
    'workerStartTimeoutMs: 90_000',
    'recognizeTimeoutMs: 90_000',
    "new CustomEvent('ripscan:ocr-heartbeat'",
    "cacheMethod: attempt === 0 ? (requestedOptions.cacheMethod || 'write') : 'refresh'",
    "Object.defineProperty(localCreateWorker, '__ripscanStallGuard'",
  ]) assert.ok(source.includes(required), `missing OCR runtime recovery contract: ${required}`);
});

test('production watchdog consumes heartbeat and keeps an absolute no-response cap', async () => {
  const build = await read('build-ocr-runtime-recovery.mjs');
  for (const required of [
    'const HARD_WATCHDOG_MS = 150_000;',
    'const WORKER_START_TIMEOUT_MS = 90_000;',
    'const RECOGNIZE_TIMEOUT_MS = 90_000;',
    "ripscan:ocr-heartbeat', event =>",
    'state.lastProgressAt = performance.now()',
  ]) assert.ok(build.includes(required), `missing production heartbeat transform: ${required}`);

  const packageJson = JSON.parse(await read('package.json'));
  assert.match(packageJson.scripts.build, /build-ocr-runtime-recovery\.mjs/);
  assert.match(packageJson.scripts.check, /build-ocr-runtime-recovery\.mjs/);

  const cache = await read('build-cache-version.mjs');
  assert.match(cache, /ripscan-pwa-v4\.1\.3/);
});
