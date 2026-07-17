import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CircuitBreaker,
  JOB_PRIORITY,
  PatchHistory,
  PriorityJobQueue,
  ResourceManager,
  TtlLruCache,
  createPerformanceConfig,
  detectLargeFileMode,
  withTimeout,
} from '../web/performance-runtime.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

test('shared queue limits heavy concurrency and respects priority', async () => {
  let active = 0;
  let peak = 0;
  const order = [];
  const queue = new PriorityJobQueue({ limits: { heavy: 2, thumbnail: 1, export: 1 } });
  const task = name => async () => {
    active += 1;
    peak = Math.max(peak, active);
    order.push(name);
    await sleep(20);
    active -= 1;
    return name;
  };
  const first = queue.enqueue(task('background'), { lane: 'heavy', priority: JOB_PRIORITY.background });
  const second = queue.enqueue(task('visible'), { lane: 'heavy', priority: JOB_PRIORITY.visible });
  const third = queue.enqueue(task('retry'), { lane: 'heavy', priority: JOB_PRIORITY.retry });
  assert.deepEqual((await Promise.all([first, second, third])).sort(), ['background', 'retry', 'visible']);
  assert.equal(peak, 2);
  assert.equal(order[0], 'background');
  assert.equal(order[1], 'visible');
  assert.equal(order[2], 'retry');
});

test('queue cancel stops pending and active jobs', async () => {
  const queue = new PriorityJobQueue({ limits: { heavy: 1 } });
  const controller = new AbortController();
  const active = queue.enqueue(async ({ signal }) => {
    while (!signal.aborted) await sleep(5);
    throw signal.reason;
  }, { id: 'active', lane: 'heavy', signal: controller.signal, timeoutMs: 1000 });
  const pending = queue.enqueue(async () => 'never', { id: 'pending', lane: 'heavy' });
  queue.cancel('pending');
  controller.abort(new DOMException('cancelled', 'AbortError'));
  await assert.rejects(active, error => error.name === 'AbortError');
  await assert.rejects(pending, error => error.name === 'AbortError');
  assert.equal(queue.size, 0);
});

test('timeout rejects work and retry is limited to one attempt', async () => {
  await assert.rejects(withTimeout(sleep(40), 5, { label: 'slow' }), error => error.code === 'JOB_TIMEOUT');
  let attempts = 0;
  const queue = new PriorityJobQueue({ limits: { heavy: 1 } });
  await assert.rejects(queue.enqueue(async () => { attempts += 1; throw new Error('fail'); }, { lane: 'heavy', retries: 1 }));
  assert.equal(attempts, 2);
});

test('circuit breaker opens and later enters half-open', () => {
  const breaker = new CircuitBreaker({ failureThreshold: 2, resetAfterMs: 10 });
  breaker.failure(0);
  assert.equal(breaker.state, 'closed');
  breaker.failure(1);
  assert.equal(breaker.state, 'open');
  assert.equal(breaker.canRun(5), false);
  assert.equal(breaker.canRun(12), true);
  assert.equal(breaker.state, 'half_open');
  breaker.success();
  assert.equal(breaker.state, 'closed');
});

test('resource manager revokes URLs closes bitmaps clears canvas and terminates workers', () => {
  const calls = [];
  const originalUrl = globalThis.URL;
  globalThis.URL = { createObjectURL: () => 'blob:test', revokeObjectURL: url => calls.push(['url', url]) };
  try {
    const resources = new ResourceManager();
    const bitmap = { close: () => calls.push(['bitmap']) };
    const canvas = { width: 10, height: 20, getContext: () => ({ clearRect: () => calls.push(['canvas']) }) };
    const worker = { terminate: () => calls.push(['worker']) };
    resources.registerObjectUrl('job', 'blob:test');
    resources.registerBitmap('job', bitmap);
    resources.registerCanvas('job', canvas);
    resources.registerWorker('job', worker);
    resources.cleanupJobResources('job');
    assert.deepEqual(resources.snapshot(), { objectUrls: 0, bitmaps: 0, canvases: 0, workers: 0, controllers: 0, jobs: 0, documents: 0 });
    assert.equal(canvas.width, 0);
    assert.equal(canvas.height, 0);
    assert.ok(calls.some(call => call[0] === 'url'));
    assert.ok(calls.some(call => call[0] === 'bitmap'));
    assert.ok(calls.some(call => call[0] === 'worker'));
  } finally {
    globalThis.URL = originalUrl;
  }
});

test('TTL cache is bounded and patch history coalesces text edits', () => {
  const evicted = [];
  const cache = new TtlLruCache({ limit: 2, ttlMs: 1000, onEvict: (_, key) => evicted.push(key) });
  cache.set('a', 1);
  cache.set('b', 2);
  cache.set('c', 3);
  assert.equal(cache.get('a'), undefined);
  assert.equal(cache.size, 2);
  for (const entry of cache.map.values()) entry.expiresAt = 0;
  cache.prune();
  assert.equal(cache.size, 0);
  assert.ok(evicted.length >= 3);

  const history = new PatchHistory({ limit: 3, coalesceMs: 1000 });
  const model = { text: 'a' };
  history.record({ path: 'text', before: 'a', after: 'ab', groupKey: 'typing' });
  history.record({ path: 'text', before: 'ab', after: 'abc', groupKey: 'typing' });
  assert.equal(history.undoStack.length, 1);
  history.undo(model);
  assert.equal(model.text, 'a');
  history.redo(model);
  assert.equal(model.text, 'abc');
});

test('large file mode reduces workers preview quality and history', () => {
  const environment = { navigator: { hardwareConcurrency: 8, deviceMemory: 8, userAgent: 'Desktop' }, localStorage: { getItem: () => 'balanced' } };
  const config = createPerformanceConfig({}, environment);
  const normal = detectLargeFileMode({ pageCount: 10, fileSize: 2_000_000 }, config);
  const large = detectLargeFileMode({ pageCount: 100, fileSize: 80_000_000 }, config);
  assert.equal(normal.enabled, false);
  assert.equal(large.enabled, true);
  assert.equal(large.workerLimit, 1);
  assert.equal(large.autoProcessNextPage, false);
  assert.ok(large.historyLimit <= 35);
});
