const DEFAULTS = Object.freeze({
  heavyDesktop: 2,
  heavyMobile: 1,
  thumbnailDesktop: 2,
  thumbnailMobile: 1,
  export: 1,
  historyLimit: 50,
  safeHistoryLimit: 20,
  cacheLimit: 96,
  cacheTtlMs: 5 * 60_000,
  safeFileBytes: 20 * 1024 * 1024,
  safePageCount: 20,
  safeRegionCount: 100,
  safeCellCount: 500,
  safeImageSide: 4000,
  safeQueueLength: 40,
});

const now = () => globalThis.performance?.now?.() ?? Date.now();
const makeId = () => globalThis.crypto?.randomUUID?.() || `job-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const abortError = message => typeof DOMException === 'function' ? new DOMException(message, 'AbortError') : Object.assign(new Error(message), { name: 'AbortError' });

export function deviceClass(env = globalThis.navigator || {}) {
  const memory = Number(env.deviceMemory || 0);
  const cores = Number(env.hardwareConcurrency || 2);
  const mobile = /Android|iPhone|iPad|Mobile/iu.test(env.userAgent || '');
  return { mobile, lowMemory: (memory > 0 && memory <= 4) || cores <= 2, memory, cores };
}

export function performanceConfig(overrides = {}, env = globalThis.navigator || {}) {
  const device = deviceClass(env);
  const safeMode = Boolean(overrides.safeMode ?? overrides.largeFileMode ?? device.mobile ?? device.lowMemory);
  const heavy = safeMode || device.mobile || device.lowMemory ? DEFAULTS.heavyMobile : DEFAULTS.heavyDesktop;
  const thumbnail = safeMode || device.mobile || device.lowMemory ? DEFAULTS.thumbnailMobile : DEFAULTS.thumbnailDesktop;
  return {
    mode: safeMode ? 'safe' : (overrides.mode || 'auto'),
    safeMode,
    heavyConcurrency: Math.max(1, Math.min(safeMode ? 1 : 2, Number(overrides.heavyConcurrency || heavy))),
    thumbnailConcurrency: Math.max(1, Math.min(safeMode ? 1 : 2, Number(overrides.thumbnailConcurrency || thumbnail))),
    exportConcurrency: 1,
    historyLimit: Math.max(10, Math.min(80, Number(overrides.historyLimit || (safeMode ? DEFAULTS.safeHistoryLimit : DEFAULTS.historyLimit)))),
    cacheLimit: Math.max(16, Math.min(192, Number(overrides.cacheLimit || DEFAULTS.cacheLimit))),
    previewMaxSide: safeMode ? 1400 : 2200,
    maxVariantsPerRegion: safeMode ? 2 : 4,
    autoProcessNextPage: safeMode ? false : overrides.autoProcessNextPage !== false,
    offscreenCanvas: overrides.offscreenCanvas !== false && typeof OffscreenCanvas !== 'undefined',
  };
}

export function shouldUseLargeFileMode({ pageCount = 0, fileSize = 0, cells = 0, regions = 0, width = 0, height = 0, queueLength = 0 } = {}, env = globalThis.navigator || {}) {
  const device = deviceClass(env);
  return pageCount > DEFAULTS.safePageCount
    || fileSize > DEFAULTS.safeFileBytes
    || cells > DEFAULTS.safeCellCount
    || regions > DEFAULTS.safeRegionCount
    || Math.max(width, height) > DEFAULTS.safeImageSide
    || queueLength > DEFAULTS.safeQueueLength
    || device.lowMemory
    || device.mobile;
}

class PriorityQueue {
  #items = [];
  push(item) { this.#items.push(item); this.#items.sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt); }
  shift() { return this.#items.shift(); }
  remove(predicate) {
    const removed = [];
    this.#items = this.#items.filter(item => {
      if (!predicate(item)) return true;
      removed.push(item);
      return false;
    });
    return removed;
  }
  get length() { return this.#items.length; }
}

export class SharedJobScheduler {
  constructor(config = performanceConfig()) {
    this.config = { ...config };
    this.queues = { heavy: new PriorityQueue(), thumbnail: new PriorityQueue(), export: new PriorityQueue() };
    this.active = { heavy: 0, thumbnail: 0, export: 0 };
    this.jobs = new Map();
    this.paused = new Set();
    this.duplicateJobsPrevented = 0;
  }

  schedule(type, task, { id = makeId(), priority = 5, signal, timeoutMs = 0 } = {}) {
    if (!this.queues[type]) throw new Error(`UNKNOWN_JOB_TYPE:${type}`);
    const existing = this.jobs.get(id);
    if (existing) {
      this.duplicateJobsPrevented += 1;
      return existing.promise;
    }
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    let resolvePromise;
    let rejectPromise;
    const promise = new Promise((resolve, reject) => { resolvePromise = resolve; rejectPromise = reject; });
    const job = {
      id, type, task, priority, timeoutMs, createdAt: now(), controller,
      resolve: resolvePromise, reject: rejectPromise, promise, state: 'pending', abort,
    };
    this.jobs.set(id, job);
    this.queues[type].push(job);
    this.#drain(type);
    return promise;
  }

  cancel(id, reason = 'JOB_CANCELLED') {
    const job = this.jobs.get(id);
    if (!job) return false;
    job.controller.abort(reason);
    for (const queue of Object.values(this.queues)) {
      for (const removed of queue.remove(item => item.id === id)) {
        removed.state = 'cancelled';
        removed.reject(abortError(reason));
        this.#finish(removed);
      }
    }
    return true;
  }

  cancelAll(reason = 'ALL_JOBS_CANCELLED') {
    for (const job of [...this.jobs.values()]) this.cancel(job.id, reason);
  }

  pause(type = 'thumbnail') { if (this.queues[type]) this.paused.add(type); }
  resume(type = 'thumbnail') { this.paused.delete(type); this.#drain(type); }

  enterSafeMode() {
    this.config = { ...this.config, ...performanceConfig({ safeMode: true }) };
    this.pause('thumbnail');
  }

  leaveSafeMode() {
    this.config = { ...this.config, ...performanceConfig({ safeMode: false }) };
    this.resume('thumbnail');
  }

  #limit(type) {
    return type === 'heavy' ? this.config.heavyConcurrency : type === 'thumbnail' ? this.config.thumbnailConcurrency : 1;
  }

  #finish(item) {
    item.controller?.signal && item.abort && item.controller.signal.removeEventListener?.('abort', item.abort);
    this.jobs.delete(item.id);
  }

  #drain(type) {
    if (this.paused.has(type)) return;
    while (this.active[type] < this.#limit(type) && this.queues[type].length) {
      const item = this.queues[type].shift();
      if (!item || !this.jobs.has(item.id)) continue;
      if (item.controller.signal.aborted) {
        item.state = 'cancelled';
        item.reject(abortError('JOB_CANCELLED'));
        this.#finish(item);
        continue;
      }
      this.active[type] += 1;
      item.state = 'running';
      const execute = () => item.task({ signal: item.controller.signal, id: item.id });
      const running = item.timeoutMs > 0 ? withTimeout(execute, item.timeoutMs, item.controller.signal) : Promise.resolve().then(execute);
      running.then(value => {
        item.state = 'completed';
        item.resolve(value);
      }, error => {
        item.state = item.controller.signal.aborted ? 'cancelled' : error?.message === 'JOB_TIMEOUT' ? 'timed_out' : 'failed';
        item.reject(error);
      }).finally(() => {
        this.active[type] = Math.max(0, this.active[type] - 1);
        this.#finish(item);
        queueMicrotask(() => this.#drain(type));
      });
    }
  }

  snapshot() {
    return {
      active: { ...this.active },
      queued: Object.fromEntries(Object.entries(this.queues).map(([key, value]) => [key, value.length])),
      jobCount: this.jobs.size,
      duplicateJobsPrevented: this.duplicateJobsPrevented,
      safeMode: Boolean(this.config.safeMode),
    };
  }
}

export class ResourceManager {
  constructor() {
    this.objectUrls = new Set();
    this.bitmaps = new Set();
    this.canvases = new Set();
    this.workers = new Set();
    this.jobResources = new Map();
  }
  #scope(jobId) {
    if (!jobId) return null;
    if (!this.jobResources.has(jobId)) this.jobResources.set(jobId, { objectUrls: new Set(), bitmaps: new Set(), canvases: new Set(), workers: new Set() });
    return this.jobResources.get(jobId);
  }
  registerObjectUrl(url, jobId) { if (url) { this.objectUrls.add(url); this.#scope(jobId)?.objectUrls.add(url); } return url; }
  releaseObjectUrl(url) { if (!url) return; try { URL.revokeObjectURL(url); } catch {} this.objectUrls.delete(url); for (const scope of this.jobResources.values()) scope.objectUrls.delete(url); }
  registerBitmap(bitmap, jobId) { if (bitmap) { this.bitmaps.add(bitmap); this.#scope(jobId)?.bitmaps.add(bitmap); } return bitmap; }
  releaseBitmap(bitmap) { try { bitmap?.close?.(); } finally { this.bitmaps.delete(bitmap); for (const scope of this.jobResources.values()) scope.bitmaps.delete(bitmap); } }
  registerCanvas(canvas, jobId) { if (canvas) { this.canvases.add(canvas); this.#scope(jobId)?.canvases.add(canvas); } return canvas; }
  releaseCanvas(canvas) { if (!canvas) return; const context = canvas.getContext?.('2d'); context?.clearRect?.(0, 0, canvas.width || 0, canvas.height || 0); canvas.width = 0; canvas.height = 0; this.canvases.delete(canvas); for (const scope of this.jobResources.values()) scope.canvases.delete(canvas); }
  registerWorker(worker, jobId) { if (worker) { this.workers.add(worker); this.#scope(jobId)?.workers.add(worker); } return worker; }
  releaseWorker(worker) { try { worker?.terminate?.(); } finally { this.workers.delete(worker); for (const scope of this.jobResources.values()) scope.workers.delete(worker); } }
  cleanupJob(jobId) {
    const scope = this.jobResources.get(jobId);
    if (!scope) return;
    for (const url of [...scope.objectUrls]) this.releaseObjectUrl(url);
    for (const bitmap of [...scope.bitmaps]) this.releaseBitmap(bitmap);
    for (const canvas of [...scope.canvases]) this.releaseCanvas(canvas);
    for (const worker of [...scope.workers]) this.releaseWorker(worker);
    this.jobResources.delete(jobId);
  }
  cleanup() {
    for (const jobId of [...this.jobResources.keys()]) this.cleanupJob(jobId);
    for (const url of [...this.objectUrls]) this.releaseObjectUrl(url);
    for (const bitmap of [...this.bitmaps]) this.releaseBitmap(bitmap);
    for (const canvas of [...this.canvases]) this.releaseCanvas(canvas);
    for (const worker of [...this.workers]) this.releaseWorker(worker);
  }
  counts() { return { objectUrls: this.objectUrls.size, bitmaps: this.bitmaps.size, canvases: this.canvases.size, workers: this.workers.size }; }
}

export class JobCache {
  constructor({ limit = DEFAULTS.cacheLimit, ttlMs = DEFAULTS.cacheTtlMs } = {}) { this.limit = limit; this.ttlMs = ttlMs; this.map = new Map(); }
  get(key) { const item = this.map.get(key); if (!item) return undefined; if (Date.now() - item.createdAt > this.ttlMs) { this.map.delete(key); return undefined; } this.map.delete(key); this.map.set(key, item); return item.value; }
  set(key, value) { if (this.map.has(key)) this.map.delete(key); this.map.set(key, { createdAt: Date.now(), value }); while (this.map.size > this.limit) this.map.delete(this.map.keys().next().value); return value; }
  delete(key) { return this.map.delete(key); }
  clear() { this.map.clear(); }
  get size() { return this.map.size; }
}

export function withTimeout(promiseFactory, ms, signal) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abort, { once: true });
  let timer;
  return Promise.race([
    Promise.resolve().then(() => promiseFactory(controller.signal)),
    new Promise((_, reject) => { timer = setTimeout(() => { controller.abort('JOB_TIMEOUT'); reject(new Error('JOB_TIMEOUT')); }, Math.max(1, ms)); }),
  ]).finally(() => { clearTimeout(timer); signal?.removeEventListener('abort', abort); });
}

export async function yieldToBrowser() {
  if (globalThis.scheduler?.yield) return globalThis.scheduler.yield();
  await new Promise(resolve => setTimeout(resolve, 0));
}

export class LongTaskGuard {
  constructor({ thresholdMs = 1000, onFreezeRisk } = {}) {
    this.thresholdMs = thresholdMs;
    this.onFreezeRisk = onFreezeRisk;
    this.entries = [];
    this.observer = null;
  }
  start() {
    if (typeof PerformanceObserver !== 'function') return false;
    try {
      this.observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          const sample = { duration: Number(entry.duration || 0), startTime: Number(entry.startTime || 0) };
          this.entries.push(sample);
          if (this.entries.length > 100) this.entries.shift();
          if (sample.duration >= this.thresholdMs) this.onFreezeRisk?.(sample);
        }
      });
      this.observer.observe({ type: 'longtask', buffered: true });
      return true;
    } catch { return false; }
  }
  stop() { this.observer?.disconnect(); this.observer = null; }
}

export const RipScanPerformance = Object.freeze({
  DEFAULTS,
  deviceClass,
  performanceConfig,
  shouldUseLargeFileMode,
  SharedJobScheduler,
  ResourceManager,
  JobCache,
  withTimeout,
  yieldToBrowser,
  LongTaskGuard,
});