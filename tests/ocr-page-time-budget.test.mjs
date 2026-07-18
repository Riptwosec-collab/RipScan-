import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('multi-region OCR page budget is longer than individual worker startup and region work', async () => {
  const core = await read('web/ocr-performance-core.mjs');
  const emergency = await read('web/book-ocr-browser-emergency.mjs');

  assert.match(core, /pageTimeoutMs:\s*5\s*\*\s*60_000/u);
  assert.match(core, /regionTimeoutMs:\s*30_000/u);
  assert.match(core, /retryTimeoutMs:\s*45_000/u);
  assert.match(emergency, /SCHEDULER_STARTUP_GRACE_MS\s*=\s*3\s*\*\s*60_000/u);
  assert.match(emergency, /OCR_LIMITS\.pageTimeoutMs\s*\+\s*SCHEDULER_STARTUP_GRACE_MS/u);
});

test('whole-page timeout is not retried and raw JOB_TIMEOUT is translated for users', async () => {
  const emergency = await read('web/book-ocr-browser-emergency.mjs');

  const recoverableSection = emergency.slice(
    emergency.indexOf('function recoverableWorkerError'),
    emergency.indexOf('function publicOcrError'),
  );
  assert.ok(!recoverableSection.includes('/JOB_TIMEOUT|'), 'whole-page timeout must not restart the entire page');
  assert.match(emergency, /การอ่านข้อความหน้านี้ใช้เวลานานเกินกำหนด/u);
  assert.match(emergency, /throw publicOcrError\(error\)/u);
});
