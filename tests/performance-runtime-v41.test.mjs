import test from 'node:test';
import assert from 'node:assert/strict';
import {
  JobCache,
  ResourceManager,
  SharedJobScheduler,
  performanceConfig,
  shouldUseLargeFileMode,
  withTimeout,
} from '../web/performance-runtime.mjs';

test('adaptive config caps desktop and mobile concurrency', () => {
  assert.equal(performanceConfig({}, { hardwareConcurrency: 8, deviceMemory: 16, userAgent: 'Desktop' }).heavyConcurrency, 2);
  assert.equal(performanceConfig({}, { hardwareConcurrency: 8, deviceMemory: 4, userAgent: 'Android Mobile' }).heavyConcurrency, 1);
  assert.equal(performanceConfig({ heavyConcurrency: 99 }, { hardwareConcurrency: 8, deviceMemory: 16, userAgent: 'Desktop' }).heavyConcurrency, 2);
});

test('large file mode activates for page cell image and low memory thresholds', () => {
  assert.equal(shouldUseLargeFileMode({ pageCount: 31 }, { hardwareConcurrency: 8, deviceMemory: 16, userAgent: 'Desktop' }), true);
  assert.equal(shouldUseLargeFileMode({ cells: 5001 }, { hardwareConcurrency: 8, deviceMemory: 16, userAgent: 'Desktop' }), true);
  assert.equal(shouldUseLargeFileMode({ pageCount: 2 }, { hardwareConcurrency: 8, deviceMemory: 16, userAgent: 'Desktop' }), false);
});

test('shared scheduler respects heavy concurrency and priority', async () => {
  const scheduler = new SharedJobScheduler({ heavyConcurrency: 1, thumbnailConcurrency: 1, exportConcurrency: 1 });
  const order = [];
  const first = scheduler.schedule('heavy', async () => { await new Promise(resolve => setTimeout(resolve, 20)); order.push('first'); }, { id: 'first', priority: 5 });
  const low = scheduler.schedule('heavy', async () => order.push('low'), { id: 'low', priority: 9 });
  const high = scheduler.schedule('heavy', async () => order.push('high'), { id: 'high', priority: 1 });
  await Promise.all([first, low, high]);
  assert.deepEqual(order, ['first', 'high', 'low']);
});

test('job cache enforces LRU limit', () => {
  const cache = new JobCache({ limit: 2, ttlMs: 60_000 });
  cache.set('a', 1); cache.set('b', 2); cache.get('a'); cache.set('c', 3);
  assert.equal(cache.get('b'), undefined);
  assert.equal(cache.get('a'), 1);
  assert.equal(cache.size, 2);
});

test('resource manager releases URL bitmap canvas and worker resources', () => {
  const original = URL.revokeObjectURL;
  const revoked = [];
  URL.revokeObjectURL = value => revoked.push(value);
  const manager = new ResourceManager();
  let closed = 0; let terminated = 0;
  const canvas = { width: 10, height: 10, getContext: () => ({ clearRect() {} }) };
  manager.registerObjectUrl('blob:test');
  manager.registerBitmap({ close() { closed += 1; } });
  manager.registerCanvas(canvas);
  manager.registerWorker({ terminate() { terminated += 1; } });
  manager.cleanup();
  URL.revokeObjectURL = original;
  assert.deepEqual(manager.counts(), { objectUrls: 0, bitmaps: 0, canvases: 0, workers: 0 });
  assert.equal(canvas.width, 0);
  assert.equal(closed, 1);
  assert.equal(terminated, 1);
  assert.deepEqual(revoked, ['blob:test']);
});

test('timeout aborts stalled work', async () => {
  await assert.rejects(() => withTimeout(signal => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })), 10), /JOB_TIMEOUT|aborted/);
});
