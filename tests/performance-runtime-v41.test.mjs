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

const desktop = { hardwareConcurrency: 8, deviceMemory: 16, userAgent: 'Desktop' };
const mobile = { hardwareConcurrency: 8, deviceMemory: 4, userAgent: 'Android Mobile' };
const cleanupTick = () => new Promise(resolve => setTimeout(resolve, 0));

test('adaptive config caps desktop and mobile concurrency', () => {
  assert.equal(performanceConfig({}, desktop).heavyConcurrency, 2);
  assert.equal(performanceConfig({}, mobile).heavyConcurrency, 1);
  assert.equal(performanceConfig({ heavyConcurrency: 99 }, desktop).heavyConcurrency, 2);
  assert.equal(performanceConfig({ safeMode: true }, desktop).thumbnailConcurrency, 1);
  assert.equal(performanceConfig({}, mobile).historyLimit, 20);
});

test('emergency safe mode activates at the required thresholds', () => {
  assert.equal(shouldUseLargeFileMode({ pageCount: 21 }, desktop), true);
  assert.equal(shouldUseLargeFileMode({ fileSize: 20 * 1024 * 1024 + 1 }, desktop), true);
  assert.equal(shouldUseLargeFileMode({ cells: 501 }, desktop), true);
  assert.equal(shouldUseLargeFileMode({ regions: 101 }, desktop), true);
  assert.equal(shouldUseLargeFileMode({ width: 4001, height: 100 }, desktop), true);
  assert.equal(shouldUseLargeFileMode({ queueLength: 41 }, desktop), true);
  assert.equal(shouldUseLargeFileMode({ pageCount: 2, fileSize: 1024 }, desktop), false);
  assert.equal(shouldUseLargeFileMode({ pageCount: 1 }, mobile), true);
});

test('shared scheduler respects heavy concurrency and priority', async () => {
  const scheduler = new SharedJobScheduler({ heavyConcurrency: 1, thumbnailConcurrency: 1, exportConcurrency: 1 });
  const order = [];
  const first = scheduler.schedule('heavy', async () => { await new Promise(resolve => setTimeout(resolve, 20)); order.push('first'); }, { id: 'first', priority: 5 });
  const low = scheduler.schedule('heavy', async () => order.push('low'), { id: 'low', priority: 9 });
  const high = scheduler.schedule('heavy', async () => order.push('high'), { id: 'high', priority: 1 });
  await Promise.all([first, low, high]);
  await cleanupTick();
  assert.deepEqual(order, ['first', 'high', 'low']);
  assert.equal(scheduler.snapshot().jobCount, 0);
});

test('duplicate job IDs share one execution', async () => {
  const scheduler = new SharedJobScheduler({ heavyConcurrency: 1, thumbnailConcurrency: 1, exportConcurrency: 1 });
  let executions = 0;
  const task = async () => { executions += 1; await new Promise(resolve => setTimeout(resolve, 10)); return 'done'; };
  const first = scheduler.schedule('heavy', task, { id: 'same-job' });
  const second = scheduler.schedule('heavy', task, { id: 'same-job' });
  assert.equal(first, second);
  assert.deepEqual(await Promise.all([first, second]), ['done', 'done']);
  assert.equal(executions, 1);
  assert.equal(scheduler.snapshot().duplicateJobsPrevented, 1);
});

test('queued jobs can be cancelled without starting', async () => {
  const scheduler = new SharedJobScheduler({ heavyConcurrency: 1, thumbnailConcurrency: 1, exportConcurrency: 1 });
  let queuedStarted = false;
  const running = scheduler.schedule('heavy', () => new Promise(resolve => setTimeout(resolve, 25)), { id: 'running' });
  const queued = scheduler.schedule('heavy', async () => { queuedStarted = true; }, { id: 'queued' });
  assert.equal(scheduler.cancel('queued'), true);
  await assert.rejects(queued, /JOB_CANCELLED|Abort/);
  await running;
  await cleanupTick();
  assert.equal(queuedStarted, false);
  assert.equal(scheduler.snapshot().jobCount, 0);
});

test('job cache enforces LRU limit', () => {
  const cache = new JobCache({ limit: 2, ttlMs: 60_000 });
  cache.set('a', 1); cache.set('b', 2); cache.get('a'); cache.set('c', 3);
  assert.equal(cache.get('b'), undefined);
  assert.equal(cache.get('a'), 1);
  assert.equal(cache.size, 2);
});

test('resource manager releases URL bitmap canvas and worker resources by job', () => {
  const original = URL.revokeObjectURL;
  const revoked = [];
  URL.revokeObjectURL = value => revoked.push(value);
  try {
    const manager = new ResourceManager();
    let closed = 0; let terminated = 0;
    const canvas = { width: 10, height: 10, getContext: () => ({ clearRect() {} }) };
    manager.registerObjectUrl('blob:test', 'job-1');
    manager.registerBitmap({ close() { closed += 1; } }, 'job-1');
    manager.registerCanvas(canvas, 'job-1');
    manager.registerWorker({ terminate() { terminated += 1; } }, 'job-1');
    manager.cleanupJob('job-1');
    assert.deepEqual(manager.counts(), { objectUrls: 0, bitmaps: 0, canvases: 0, workers: 0 });
    assert.equal(canvas.width, 0);
    assert.equal(canvas.height, 0);
    assert.equal(closed, 1);
    assert.equal(terminated, 1);
    assert.deepEqual(revoked, ['blob:test']);
  } finally {
    URL.revokeObjectURL = original;
  }
});

test('timeout aborts stalled work', async () => {
  await assert.rejects(() => withTimeout(signal => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })), 10), /JOB_TIMEOUT|aborted/);
});
