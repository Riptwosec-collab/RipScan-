const DEFAULTS = Object.freeze({
  heavyDesktop: 2,
  heavyMobile: 1,
  thumbnailDesktop: 3,
  thumbnailMobile: 1,
  export: 1,
  historyLimit: 60,
  cacheLimit: 128,
  cacheTtlMs: 5 * 60_000,
});

export function deviceClass(env = globalThis.navigator || {}) {
  const memory = Number(env.deviceMemory || 0);
  const cores = Number(env.hardwareConcurrency || 2);
  const mobile = /Android|iPhone|iPad|Mobile/iu.test(env.userAgent || '');
  return { mobile, lowMemory: (memory > 0 && memory <= 4) || cores <= 2, memory, cores };
}

export function performanceConfig(overrides = {}, env = globalThis.navigator || {}) {
  const device = deviceClass(env);
  const heavy = device.mobile || device.lowMemory ? DEFAULTS.heavyMobile : DEFAULTS.heavyDesktop;
  const thumbnail = device.mobile || device.lowMemory ? DEFAULTS.thumbnailMobile : DEFAULTS.thumbnailDesktop;
  return {
    mode: 'auto',
    heavyConcurrency: Math.max(1, Math.min(2, Number(overrides.heavyConcurrency || heavy))),
    thumbnailConcurrency: Math.max(1, Math.min(3, Number(overrides.thumbnailConcurrency || thumbnail))),
    exportConcurrency: 1,
    historyLimit: Math.max(10, Math.min(80, Number(overrides.historyLimit || DEFAULTS.historyLimit))),
    cacheLimit: Math.max(16, Math.min(256, Number(overrides.cacheLimit || DEFAULTS.cacheLimit))),
    largeFileMode: Boolean(overrides.largeFileMode),
    offscreenCanvas: overrides.offscreenCanvas !== false && typeof OffscreenCanvas !== 'undefined',
  };
}

export function shouldUseLargeFileMode({ pageCount = 0, fileSize = 0, cells = 0, width = 0, height = 0 } = {}, env = globalThis.navigator || {}) {
  const device = deviceClass(env);
  return pageCount > 30 || fileSize > 80 * 1024 * 1024 || cells > 3000 || width * height > 40_000_000 || device.lowMemory || device.mobile;
}

class PriorityQueue {
  #items = [];
  push(item) { this.#items.push(item); this.#items.sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt); }
  shift() { return this.#items.shift(); }
  remove(predicate) { this.#items = this.#items.filter(item => !predicate(item)); }
  get length() { return this.#items.length; }
}

export class SharedJobScheduler {
  constructor(config = performanceConfig()) {
    this.config = config;
    this.queues = { heavy: new PriorityQueue(), thumbnail: new PriorityQueue(), export: new PriorityQueue() };
    this.active = { heavy: 0, thumbnail: 0, export: 0 };
    this.controllers = new Map();
  }

  schedule(type, task, { id = crypto.randomUUID(), priority = 5, signal } = {}) {
    if (!this.queues[type]) throw new Error(`UNKNOWN_JOB_TYPE:${type}`);
    const controller = new AbortController();
    if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });
    this.controllers.set(id, controller);
    return new Promise((resolve, reject) => {
      this.queues[type].push({ id, type, task, priority, createdAt: performance.now(), controller, resolve, reject });
      this.#drain(type);
    });
  }

  cancel(id) {
    this.controllers.get(id)?.abort();
    for (const queue of Object.values(this.queues)) queue.remove(item => item.id === id);
    this.controllers.delete(id);
  }

  cancelAll() {
    for (const controller of this.controllers.values()) controller.abort();
    for (const queue of Object.values(this.queues)) queue.remove(() => true);
    this.controllers.clear();
  }

  #limit(type) {
    return type === 'heavy' ? this.config.heavyConcurrency : type === 'thumbnail' ? this.config.thumbnailConcurrency : 1;
  }

  #drain(type) {
    while (this.active[type] < this.#limit(type) && this.queues[type].length) {
      const item = this.queues[type].shift();
      if (item.controller.signal.aborted) { item.reject(new DOMException('Aborted', 'AbortError')); continue; }
      this.active[type] += 1;
      Promise.resolve().then(() => item.task({ signal: item.controller.signal, id: item.id })).then(item.resolve, item.reject).finally(() => {
        this.active[type] -= 1;
        this.controllers.delete(item.id);
        queueMicrotask(() => this.#drain(type));
      });
    }
  }

  snapshot() {
    return { active: { ...this.active }, queued: Object.fromEntries(Object.entries(this.queues).map(([key, value]) => [key, value.length])) };
  }
}

export class ResourceManager {
  constructor() {
    this.objectUrls = new Set();
    this.bitmaps = new Set();
    this.canvases = new Set();
    this.workers = new Set();
  }
  registerObjectUrl(url) { if (url) this.objectUrls.add(url); return url; }
  releaseObjectUrl(url) { if (!url) return; URL.revokeObjectURL(url); this.objectUrls.delete(url); }
  registerBitmap(bitmap) { if (bitmap) this.bitmaps.add(bitmap); return bitmap; }
  releaseBitmap(bitmap) { try { bitmap?.close?.(); } finally { this.bitmaps.delete(bitmap); } }
  registerCanvas(canvas) { if (canvas) this.canvases.add(canvas); return canvas; }
  releaseCanvas(canvas) { if (!canvas) return; const context = canvas.getContext?.('2d'); context?.clearRect?.(0, 0, canvas.width || 0, canvas.height || 0); canvas.width = 0; canvas.height = 0; this.canvases.delete(canvas); }
  registerWorker(worker) { if (worker) this.workers.add(worker); return worker; }
  releaseWorker(worker) { try { worker?.terminate?.(); } finally { this.workers.delete(worker); } }
  cleanup() {
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
  clear() { this.map.clear(); }
  get size() { return this.map.size; }
}

export function withTimeout(promiseFactory, ms, signal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  let timer;
  return Promise.race([
    Promise.resolve().then(() => promiseFactory(controller.signal)),
    new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('JOB_TIMEOUT')); }, ms); }),
  ]).finally(() => { clearTimeout(timer); signal?.removeEventListener('abort', abort); });
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
});
