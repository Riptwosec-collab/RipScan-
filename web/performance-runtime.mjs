export const PERFORMANCE_VERSION = '5.0.0';

const DEFAULTS = Object.freeze({
  mode: 'auto',
  previewQuality: 0.72,
  thumbnailQuality: 0.54,
  autoProcessNextPage: true,
  ocrVariantLimit: 4,
  historyLimit: 70,
  cacheLimit: 96,
  cacheTtlMs: 10 * 60 * 1000,
  offscreenCanvas: true,
  telemetry: false,
  largeFilePageThreshold: 30,
  largeFileBytesThreshold: 60 * 1024 * 1024,
  largeTableCellThreshold: 2500,
  lowMemoryBytesThreshold: 420 * 1024 * 1024,
  timeoutMs: Object.freeze({
    textRegion: 15_000,
    tableCell: 15_000,
    pdfPage: 30_000,
    pageOcr: 60_000,
    exportPage: 30_000,
  }),
});

const MODE_OVERRIDES = Object.freeze({
  saver: { previewQuality: .5, thumbnailQuality: .34, autoProcessNextPage: false, ocrVariantLimit: 2, historyLimit: 35, cacheLimit: 36 },
  balanced: { previewQuality: .72, thumbnailQuality: .54, autoProcessNextPage: true, ocrVariantLimit: 4, historyLimit: 70, cacheLimit: 96 },
  performance: { previewQuality: .84, thumbnailQuality: .66, autoProcessNextPage: true, ocrVariantLimit: 5, historyLimit: 80, cacheLimit: 128 },
});

export function detectDeviceProfile(environment = globalThis) {
  const navigatorObject = environment.navigator || {};
  const memory = Number(navigatorObject.deviceMemory || 0);
  const cores = Math.max(1, Number(navigatorObject.hardwareConcurrency || 2));
  const mobile = Boolean(navigatorObject.userAgentData?.mobile) || /Android|iPhone|iPad|Mobile/iu.test(String(navigatorObject.userAgent || ''));
  const lowMemory = (memory > 0 && memory <= 4) || mobile;
  return {
    mobile,
    memoryGb: memory || null,
    cores,
    lowMemory,
    lanes: {
      heavy: mobile || lowMemory ? 1 : Math.min(2, Math.max(1, cores - 1)),
      thumbnail: mobile || lowMemory ? 1 : Math.min(3, Math.max(1, Math.floor(cores / 2))),
      export: 1,
    },
  };
}

export function createPerformanceConfig(input = {}, environment = globalThis) {
  const profile = detectDeviceProfile(environment);
  const requestedMode = input.mode || readStoredMode(environment) || 'auto';
  const resolvedMode = requestedMode === 'auto' ? (profile.lowMemory ? 'saver' : 'balanced') : requestedMode;
  const overrides = MODE_OVERRIDES[resolvedMode] || MODE_OVERRIDES.balanced;
  const config = {
    ...DEFAULTS,
    ...overrides,
    ...input,
    mode: requestedMode,
    resolvedMode,
    profile,
    lanes: { ...profile.lanes, ...(input.lanes || {}) },
    timeoutMs: { ...DEFAULTS.timeoutMs, ...(input.timeoutMs || {}) },
  };
  if (profile.lowMemory) {
    config.autoProcessNextPage = false;
    config.ocrVariantLimit = Math.min(config.ocrVariantLimit, 3);
    config.historyLimit = Math.min(config.historyLimit, 40);
    config.cacheLimit = Math.min(config.cacheLimit, 48);
  }
  return Object.freeze(config);
}

function readStoredMode(environment) {
  try { return environment.localStorage?.getItem('ripscan-performance-mode') || ''; }
  catch { return ''; }
}

export const JOB_PRIORITY = Object.freeze({
  visible: 100,
  currentPage: 90,
  retry: 80,
  nearbyThumbnail: 50,
  background: 10,
});

function abortError(message = 'งานถูกยกเลิก') {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

export function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : abortError();
}

export async function yieldToMain() {
  if (globalThis.scheduler?.yield) return globalThis.scheduler.yield();
  return new Promise(resolve => setTimeout(resolve, 0));
}

export function withTimeout(promiseOrFactory, timeoutMs, { signal, label = 'งาน' } = {}) {
  return new Promise((resolve, reject) => {
    throwIfAborted(signal);
    let settled = false;
    const finish = callback => value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
      callback(value);
    };
    const onAbort = () => finish(reject)(signal.reason instanceof Error ? signal.reason : abortError());
    signal?.addEventListener?.('abort', onAbort, { once: true });
    const timer = setTimeout(() => {
      const error = new Error(`${label} ใช้เวลานานเกิน ${Math.round(timeoutMs / 1000)} วินาที`);
      error.code = 'JOB_TIMEOUT';
      finish(reject)(error);
    }, Math.max(1, timeoutMs));
    Promise.resolve().then(() => typeof promiseOrFactory === 'function' ? promiseOrFactory() : promiseOrFactory).then(finish(resolve), finish(reject));
  });
}

export class CircuitBreaker {
  constructor({ failureThreshold = 3, resetAfterMs = 30_000, halfOpenSuccesses = 1 } = {}) {
    this.failureThreshold = failureThreshold;
    this.resetAfterMs = resetAfterMs;
    this.halfOpenSuccesses = halfOpenSuccesses;
    this.state = 'closed';
    this.failures = 0;
    this.successes = 0;
    this.openedAt = 0;
  }
  canRun(now = Date.now()) {
    if (this.state === 'closed') return true;
    if (this.state === 'open' && now - this.openedAt >= this.resetAfterMs) {
      this.state = 'half_open';
      this.successes = 0;
      return true;
    }
    return this.state === 'half_open';
  }
  success() {
    if (this.state === 'half_open') {
      this.successes += 1;
      if (this.successes >= this.halfOpenSuccesses) this.reset();
    } else {
      this.failures = 0;
    }
  }
  failure(now = Date.now()) {
    this.failures += 1;
    if (this.state === 'half_open' || this.failures >= this.failureThreshold) {
      this.state = 'open';
      this.openedAt = now;
    }
  }
  reset() {
    this.state = 'closed';
    this.failures = 0;
    this.successes = 0;
    this.openedAt = 0;
  }
}

let jobSequence = 0;

export class PriorityJobQueue {
  constructor({ limits = { heavy: 2, thumbnail: 3, export: 1 }, onChange = () => {} } = {}) {
    this.limits = { heavy: 2, thumbnail: 3, export: 1, ...limits };
    this.onChange = onChange;
    this.pending = [];
    this.active = new Map();
    this.paused = false;
    this.breakers = new Map();
  }
  get size() { return this.pending.length; }
  activeCount(lane) { return [...this.active.values()].filter(job => !lane || job.lane === lane).length; }
  snapshot() {
    return { pending: this.pending.length, active: this.active.size, lanes: Object.fromEntries(Object.keys(this.limits).map(lane => [lane, this.activeCount(lane)])), paused: this.paused };
  }
  enqueue(task, options = {}) {
    if (typeof task !== 'function') throw new TypeError('task must be a function');
    const id = options.id || `job-${Date.now()}-${++jobSequence}`;
    const lane = options.lane || 'heavy';
    const controller = new AbortController();
    const externalSignal = options.signal;
    const relayAbort = () => controller.abort(externalSignal.reason || abortError());
    if (externalSignal?.aborted) relayAbort();
    else externalSignal?.addEventListener?.('abort', relayAbort, { once: true });
    let resolvePromise;
    let rejectPromise;
    const promise = new Promise((resolve, reject) => { resolvePromise = resolve; rejectPromise = reject; });
    const job = {
      id,
      lane,
      task,
      priority: Number(options.priority ?? JOB_PRIORITY.background),
      createdAt: Date.now(),
      timeoutMs: Number(options.timeoutMs || 30_000),
      retries: Math.max(0, Math.min(1, Number(options.retries ?? 0))),
      attempt: 0,
      controller,
      externalSignal,
      relayAbort,
      breakerKey: options.breakerKey || '',
      resolve: resolvePromise,
      reject: rejectPromise,
    };
    this.pending.push(job);
    this.pending.sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt);
    this.#notify();
    this.#pump();
    promise.cancel = () => this.cancel(id);
    promise.id = id;
    return promise;
  }
  cancel(id, reason = abortError()) {
    const index = this.pending.findIndex(job => job.id === id);
    if (index >= 0) {
      const [job] = this.pending.splice(index, 1);
      job.controller.abort(reason);
      job.externalSignal?.removeEventListener?.('abort', job.relayAbort);
      job.reject(reason);
      this.#notify();
      return true;
    }
    const active = this.active.get(id);
    if (active) {
      active.controller.abort(reason);
      return true;
    }
    return false;
  }
  cancelAll(reason = abortError()) {
    for (const job of [...this.pending]) this.cancel(job.id, reason);
    for (const job of this.active.values()) job.controller.abort(reason);
  }
  pause() { this.paused = true; this.#notify(); }
  resume() { this.paused = false; this.#notify(); this.#pump(); }
  setLimit(lane, value) { this.limits[lane] = Math.max(1, Number(value) || 1); this.#pump(); }
  #breaker(key) {
    if (!key) return null;
    if (!this.breakers.has(key)) this.breakers.set(key, new CircuitBreaker());
    return this.breakers.get(key);
  }
  #nextRunnable() {
    return this.pending.findIndex(job => this.activeCount(job.lane) < (this.limits[job.lane] || 1));
  }
  #pump() {
    if (this.paused) return;
    let index = this.#nextRunnable();
    while (index >= 0) {
      const [job] = this.pending.splice(index, 1);
      this.#run(job);
      index = this.#nextRunnable();
    }
    this.#notify();
  }
  async #run(job) {
    this.active.set(job.id, job);
    this.#notify();
    const breaker = this.#breaker(job.breakerKey);
    try {
      if (breaker && !breaker.canRun()) {
        const error = new Error('ผู้ให้บริการหยุดชั่วคราวหลังเกิดข้อผิดพลาดต่อเนื่อง');
        error.code = 'CIRCUIT_OPEN';
        throw error;
      }
      let lastError;
      for (let attempt = 0; attempt <= job.retries; attempt += 1) {
        job.attempt = attempt;
        try {
          throwIfAborted(job.controller.signal);
          const value = await withTimeout(() => job.task({ signal: job.controller.signal, attempt, id: job.id }), job.timeoutMs, { signal: job.controller.signal, label: job.id });
          breaker?.success();
          job.resolve(value);
          return;
        } catch (error) {
          lastError = error;
          if (error?.name === 'AbortError' || attempt >= job.retries) break;
          await yieldToMain();
        }
      }
      breaker?.failure();
      job.reject(lastError);
    } finally {
      job.externalSignal?.removeEventListener?.('abort', job.relayAbort);
      this.active.delete(job.id);
      this.#notify();
      this.#pump();
    }
  }
  #notify() { try { this.onChange(this.snapshot()); } catch {} }
}

export class TtlLruCache {
  constructor({ limit = 96, ttlMs = 10 * 60 * 1000, onEvict = () => {} } = {}) {
    this.limit = Math.max(1, limit);
    this.ttlMs = Math.max(1000, ttlMs);
    this.onEvict = onEvict;
    this.map = new Map();
  }
  get size() { this.prune(); return this.map.size; }
  get(key) {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) { this.delete(key); return undefined; }
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }
  set(key, value, ttlMs = this.ttlMs) {
    if (this.map.has(key)) this.delete(key);
    this.map.set(key, { value, expiresAt: Date.now() + ttlMs });
    while (this.map.size > this.limit) this.delete(this.map.keys().next().value);
    return value;
  }
  has(key) { return this.get(key) !== undefined; }
  delete(key) {
    const entry = this.map.get(key);
    if (!entry) return false;
    this.map.delete(key);
    try { this.onEvict(entry.value, key); } catch {}
    return true;
  }
  prune() {
    const now = Date.now();
    for (const [key, entry] of this.map) if (entry.expiresAt <= now) this.delete(key);
  }
  clear() { for (const key of [...this.map.keys()]) this.delete(key); }
}

export class ResourceManager {
  constructor() {
    this.jobs = new Map();
    this.documents = new Map();
    this.counts = { objectUrls: 0, bitmaps: 0, canvases: 0, workers: 0, controllers: 0 };
  }
  #bucket(kind, id) {
    const root = kind === 'document' ? this.documents : this.jobs;
    if (!root.has(id)) root.set(id, { objectUrls: new Set(), bitmaps: new Set(), canvases: new Set(), workers: new Set(), controllers: new Set(), cleanup: new Set() });
    return root.get(id);
  }
  registerObjectUrl(id, url, kind = 'job') { if (!url) return url; this.#bucket(kind, id).objectUrls.add(url); this.counts.objectUrls += 1; return url; }
  createObjectUrl(id, blob, kind = 'job') { return this.registerObjectUrl(id, URL.createObjectURL(blob), kind); }
  releaseObjectUrl(id, url, kind = 'job') {
    const bucket = this.#bucket(kind, id);
    if (!bucket.objectUrls.delete(url)) return false;
    try { URL.revokeObjectURL(url); } catch {}
    this.counts.objectUrls = Math.max(0, this.counts.objectUrls - 1);
    return true;
  }
  registerBitmap(id, bitmap, kind = 'job') { if (!bitmap) return bitmap; this.#bucket(kind, id).bitmaps.add(bitmap); this.counts.bitmaps += 1; return bitmap; }
  releaseBitmap(id, bitmap, kind = 'job') { const bucket = this.#bucket(kind, id); if (!bucket.bitmaps.delete(bitmap)) return false; try { bitmap.close?.(); } catch {} this.counts.bitmaps = Math.max(0, this.counts.bitmaps - 1); return true; }
  registerCanvas(id, canvas, kind = 'job') { if (!canvas) return canvas; this.#bucket(kind, id).canvases.add(canvas); this.counts.canvases += 1; return canvas; }
  releaseCanvas(id, canvas, kind = 'job') {
    const bucket = this.#bucket(kind, id);
    if (!bucket.canvases.delete(canvas)) return false;
    try { const context = canvas.getContext?.('2d'); context?.clearRect?.(0, 0, canvas.width, canvas.height); canvas.width = 0; canvas.height = 0; } catch {}
    this.counts.canvases = Math.max(0, this.counts.canvases - 1);
    return true;
  }
  registerWorker(id, worker, kind = 'job') { if (!worker) return worker; this.#bucket(kind, id).workers.add(worker); this.counts.workers += 1; return worker; }
  releaseWorker(id, worker, kind = 'job') { const bucket = this.#bucket(kind, id); if (!bucket.workers.delete(worker)) return false; try { worker.terminate?.(); } catch {} this.counts.workers = Math.max(0, this.counts.workers - 1); return true; }
  registerController(id, controller, kind = 'job') { if (!controller) return controller; this.#bucket(kind, id).controllers.add(controller); this.counts.controllers += 1; return controller; }
  addCleanup(id, callback, kind = 'job') { if (typeof callback === 'function') this.#bucket(kind, id).cleanup.add(callback); return callback; }
  cleanupJobResources(id) { this.#cleanup(this.jobs, id); }
  cleanupDocumentResources(id) { this.#cleanup(this.documents, id); }
  cleanupAll() { for (const id of [...this.jobs.keys()]) this.cleanupJobResources(id); for (const id of [...this.documents.keys()]) this.cleanupDocumentResources(id); }
  #cleanup(root, id) {
    const bucket = root.get(id);
    if (!bucket) return;
    for (const controller of bucket.controllers) try { controller.abort(abortError('ปิดงานและคืนทรัพยากร')); } catch {}
    for (const worker of bucket.workers) try { worker.terminate?.(); } catch {}
    for (const bitmap of bucket.bitmaps) try { bitmap.close?.(); } catch {}
    for (const canvas of bucket.canvases) try { const context = canvas.getContext?.('2d'); context?.clearRect?.(0, 0, canvas.width, canvas.height); canvas.width = 0; canvas.height = 0; } catch {}
    for (const url of bucket.objectUrls) try { URL.revokeObjectURL(url); } catch {}
    for (const callback of bucket.cleanup) try { callback(); } catch {}
    this.counts.objectUrls = Math.max(0, this.counts.objectUrls - bucket.objectUrls.size);
    this.counts.bitmaps = Math.max(0, this.counts.bitmaps - bucket.bitmaps.size);
    this.counts.canvases = Math.max(0, this.counts.canvases - bucket.canvases.size);
    this.counts.workers = Math.max(0, this.counts.workers - bucket.workers.size);
    this.counts.controllers = Math.max(0, this.counts.controllers - bucket.controllers.size);
    root.delete(id);
  }
  snapshot() { return { ...this.counts, jobs: this.jobs.size, documents: this.documents.size }; }
}

function splitPath(path) { return Array.isArray(path) ? path : String(path).split('.').filter(Boolean).map(part => /^\d+$/u.test(part) ? Number(part) : part); }
function getAt(root, path) { return splitPath(path).reduce((value, key) => value?.[key], root); }
function setAt(root, path, value) {
  const keys = splitPath(path);
  const last = keys.pop();
  let cursor = root;
  for (const key of keys) cursor = cursor[key];
  cursor[last] = structuredCloneSafe(value);
}
function structuredCloneSafe(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

export class PatchHistory {
  constructor({ limit = 70, coalesceMs = 750 } = {}) {
    this.limit = Math.max(1, limit);
    this.coalesceMs = coalesceMs;
    this.undoStack = [];
    this.redoStack = [];
  }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  record({ type = 'PATCH', path, before, after, label = 'แก้ไข', groupKey = '' }) {
    if (Object.is(before, after) || JSON.stringify(before) === JSON.stringify(after)) return false;
    const entry = { type, path: splitPath(path), before: structuredCloneSafe(before), after: structuredCloneSafe(after), label, groupKey, at: Date.now() };
    const previous = this.undoStack.at(-1);
    if (groupKey && previous?.groupKey === groupKey && entry.at - previous.at <= this.coalesceMs) {
      previous.after = entry.after;
      previous.at = entry.at;
      previous.label = label;
    } else {
      this.undoStack.push(entry);
      if (this.undoStack.length > this.limit) this.undoStack.shift();
    }
    this.redoStack = [];
    return true;
  }
  undo(model) {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    setAt(model, entry.path, entry.before);
    this.redoStack.push(entry);
    return entry;
  }
  redo(model) {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    setAt(model, entry.path, entry.after);
    this.undoStack.push(entry);
    return entry;
  }
  clear() { this.undoStack = []; this.redoStack = []; }
}

export function detectLargeFileMode({ fileSize = 0, pageCount = 0, pixelCount = 0, tableCells = 0 } = {}, config = createPerformanceConfig()) {
  const enabled = Number(pageCount) > config.largeFilePageThreshold
    || Number(fileSize) > config.largeFileBytesThreshold
    || Number(pixelCount) > 32_000_000
    || Number(tableCells) > config.largeTableCellThreshold
    || config.profile.lowMemory;
  return {
    enabled,
    workerLimit: enabled ? 1 : config.lanes.heavy,
    thumbnailQuality: enabled ? Math.min(config.thumbnailQuality, .36) : config.thumbnailQuality,
    previewQuality: enabled ? Math.min(config.previewQuality, .56) : config.previewQuality,
    historyLimit: enabled ? Math.min(config.historyLimit, 35) : config.historyLimit,
    autoProcessNextPage: enabled ? false : config.autoProcessNextPage,
    liveFidelityPreview: !enabled,
  };
}

export class PerformanceMetrics {
  constructor({ enabled = true, onMetric = () => {} } = {}) {
    this.enabled = enabled;
    this.onMetric = onMetric;
    this.metrics = { longTasks: 0, longTaskDuration: 0, fps: null, lcp: null, cls: 0, inp: null };
    this.observers = [];
    this.fpsHandle = 0;
  }
  start() {
    if (!this.enabled || typeof PerformanceObserver === 'undefined') return;
    this.#observe('longtask', entries => {
      for (const entry of entries) { this.metrics.longTasks += 1; this.metrics.longTaskDuration += entry.duration; this.#emit('longtask', entry.duration); }
    });
    this.#observe('largest-contentful-paint', entries => { const entry = entries.at(-1); if (entry) { this.metrics.lcp = entry.startTime; this.#emit('lcp', entry.startTime); } });
    this.#observe('layout-shift', entries => { for (const entry of entries) if (!entry.hadRecentInput) this.metrics.cls += entry.value; });
    this.#observe('event', entries => { const value = Math.max(0, ...entries.map(entry => entry.duration || 0)); if (value) { this.metrics.inp = Math.max(this.metrics.inp || 0, value); this.#emit('inp', value); } }, { durationThreshold: 40 });
    this.#startFps();
  }
  stop() { for (const observer of this.observers) observer.disconnect(); this.observers = []; if (this.fpsHandle) cancelAnimationFrame(this.fpsHandle); this.fpsHandle = 0; }
  snapshot(resourceManager) {
    const memory = globalThis.performance?.memory;
    return {
      ...this.metrics,
      domNodes: typeof document === 'undefined' ? 0 : document.getElementsByTagName('*').length,
      canvases: typeof document === 'undefined' ? 0 : document.querySelectorAll('canvas').length,
      memoryBytes: memory?.usedJSHeapSize || null,
      resources: resourceManager?.snapshot?.() || null,
    };
  }
  #observe(type, callback, options = {}) {
    try { const observer = new PerformanceObserver(list => callback(list.getEntries())); observer.observe({ type, buffered: true, ...options }); this.observers.push(observer); } catch {}
  }
  #startFps() {
    if (typeof requestAnimationFrame === 'undefined') return;
    let frames = 0;
    let started = performance.now();
    const tick = now => {
      frames += 1;
      if (now - started >= 1000) { this.metrics.fps = Math.round(frames * 1000 / (now - started)); frames = 0; started = now; }
      this.fpsHandle = requestAnimationFrame(tick);
    };
    this.fpsHandle = requestAnimationFrame(tick);
  }
  #emit(name, value) { try { this.onMetric({ name, value, at: Date.now() }); } catch {} }
}

export async function loadScript(url, { globalName, timeoutMs = 20_000 } = {}) {
  if (globalName && globalThis[globalName]) return globalThis[globalName];
  const existing = typeof document === 'undefined' ? null : document.querySelector(`script[data-ripscan-lazy="${CSS.escape(url)}"]`);
  if (existing) return withTimeout(new Promise((resolve, reject) => { existing.addEventListener('load', resolve, { once: true }); existing.addEventListener('error', reject, { once: true }); }), timeoutMs, { label: url });
  if (typeof document === 'undefined') throw new Error(`ไม่สามารถโหลด ${url} นอก Browser`);
  return withTimeout(new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.dataset.ripscanLazy = url;
    script.onload = () => resolve(globalName ? globalThis[globalName] : true);
    script.onerror = () => reject(new Error(`โหลด ${url} ไม่สำเร็จ`));
    document.head.append(script);
  }), timeoutMs, { label: url });
}

export function createSharedPerformanceRuntime(options = {}, environment = globalThis) {
  const config = createPerformanceConfig(options, environment);
  const resources = new ResourceManager();
  const cache = new TtlLruCache({ limit: config.cacheLimit, ttlMs: config.cacheTtlMs });
  const queue = new PriorityJobQueue({ limits: config.lanes });
  const metrics = new PerformanceMetrics({ enabled: typeof document !== 'undefined' });
  return { version: PERFORMANCE_VERSION, config, resources, cache, queue, metrics, detectLargeFileMode: input => detectLargeFileMode(input, config), yieldToMain, loadScript };
}
