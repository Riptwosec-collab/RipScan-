import { JOB_PRIORITY, withTimeout } from './performance-runtime.mjs';

let workerSequence = 0;

function runtime() {
  return globalThis.RipScanPerformance?.runtime || globalThis.RipScanPerformance;
}

function createAbortError() {
  const error = new Error('งานถูกยกเลิก');
  error.name = 'AbortError';
  return error;
}

function maxSideForRuntime() {
  const config = runtime()?.config;
  const large = globalThis.RipScanPerformance?.largeFileMode?.enabled;
  if (large) return 1500;
  if (config?.resolvedMode === 'saver') return 1700;
  if (config?.resolvedMode === 'performance') return 2600;
  return 2200;
}

class ImagePreprocessClient {
  constructor() {
    this.worker = null;
    this.pending = new Map();
    this.disposed = false;
  }
  ensureWorker() {
    if (this.disposed) throw new Error('ImagePreprocessClient ถูกปิดแล้ว');
    if (this.worker) return this.worker;
    this.worker = new Worker('/performance-image-worker.js', { type: 'module' });
    this.worker.addEventListener('message', event => this.#handleMessage(event.data || {}));
    this.worker.addEventListener('error', error => {
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
      this.restart();
    });
    return this.worker;
  }
  async process(source, { mode = 'base', signal, timeoutMs = 15_000, priority = JOB_PRIORITY.visible } = {}) {
    const queue = runtime()?.queue;
    const task = async ({ signal: queueSignal }) => {
      const combined = signal || queueSignal;
      if (combined?.aborted) throw createAbortError();
      const bitmap = await createImageBitmap(source);
      const jobId = `image-preprocess-${Date.now()}-${++workerSequence}`;
      const worker = this.ensureWorker();
      const promise = new Promise((resolve, reject) => {
        const onAbort = () => {
          worker.postMessage({ type: 'cancel', jobId });
          this.pending.delete(jobId);
          try { bitmap.close?.(); } catch {}
          reject(createAbortError());
        };
        combined?.addEventListener?.('abort', onAbort, { once: true });
        this.pending.set(jobId, {
          resolve: result => { combined?.removeEventListener?.('abort', onAbort); resolve(result); },
          reject: error => { combined?.removeEventListener?.('abort', onAbort); reject(error); },
        });
      });
      worker.postMessage({ type: 'process', jobId, bitmap, mode, maxSide: maxSideForRuntime() }, [bitmap]);
      return withTimeout(promise, timeoutMs, { signal: combined, label: `เตรียมภาพ ${mode}` });
    };
    if (queue) return queue.enqueue(task, { lane: 'heavy', priority, timeoutMs: timeoutMs + 1000, retries: 0, signal });
    return task({ signal });
  }
  #handleMessage(message) {
    const pending = this.pending.get(message.jobId);
    if (!pending) return;
    this.pending.delete(message.jobId);
    if (message.type === 'error') {
      const error = new Error(message.message || 'เตรียมภาพไม่สำเร็จ');
      error.name = message.name || 'Error';
      pending.reject(error);
    } else {
      pending.resolve({ deskewAngle: Number(message.deskewAngle || 0), variants: message.variants || [] });
    }
  }
  restart() {
    try { this.worker?.terminate(); } catch {}
    this.worker = null;
  }
  dispose() {
    this.disposed = true;
    try { this.worker?.postMessage({ type: 'dispose' }); } catch {}
    try { this.worker?.terminate(); } catch {}
    this.worker = null;
    for (const pending of this.pending.values()) pending.reject(createAbortError());
    this.pending.clear();
  }
}

const singleton = new ImagePreprocessClient();

export function preprocessOcrVariants(source, options) {
  return singleton.process(source, options);
}

export function disposeImagePreprocessClient() {
  singleton.dispose();
}
