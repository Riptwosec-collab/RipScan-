import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('emergency performance UI wires shared scheduler safe mode and cleanup into the existing page', async () => {
  const source = await read('web/performance-emergency-ui.js');
  for (const required of [
    'SharedJobScheduler', 'ResourceManager', 'JobCache', 'LongTaskGuard',
    'shouldUseLargeFileMode', 'scheduler.enterSafeMode()', "scheduler.pause('thumbnail')",
    'scheduler.cancelAll', 'resources.cleanup()', 'cache.clear()',
    "window.addEventListener('pagehide'", "document.addEventListener('visibilitychange'",
    "document.addEventListener('ripscan:job-cancel'", 'requestAnimationFrame',
  ]) assert.ok(source.includes(required), `missing ${required}`);
});

test('emergency guard prevents duplicate primary actions and exposes a shared API', async () => {
  const source = await read('web/performance-emergency-ui.js');
  for (const required of [
    "button.dataset.jobRunning === 'true'", 'activeUiJobs.has(key)',
    'event.stopImmediatePropagation()', 'beginUiJob', 'cancelUiJob',
    'globalThis.RipScanPerformance', 'duplicateJobsPrevented',
  ]) assert.ok(source.includes(required), `missing ${required}`);
});

test('theme UI loads the emergency guard without creating another application shell', async () => {
  const theme = await read('web/theme-ui.js');
  assert.ok(theme.startsWith("import './performance-emergency-ui.js';"));
  assert.ok(!theme.includes("document.createElement('main')"));
  const packageJson = JSON.parse(await read('package.json'));
  assert.ok(packageJson.scripts.check.includes('web/performance-emergency-ui.js'));
});
