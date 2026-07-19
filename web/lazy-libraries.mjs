const sources = Object.freeze({
  tesseract: '/vendor/tesseract.min.js',
  pdfjs: '/vendor/pdf.min.mjs',
  pdfWorker: '/vendor/pdf.worker.min.mjs',
  jszip: '/vendor/jszip.min.js',
});

const pending = new Map();
const LIBRARY_TIMEOUT_MS = 15_000;
const OCR_RUNTIME = Object.freeze({
  workerPath: '/vendor/worker.min.js',
  corePath: '/vendor/tesseract-core',
  langPath: '/vendor/tessdata',
  workerStartTimeoutMs: 30_000,
  recognizeTimeoutMs: 60_000,
  heartbeatMs: 4_000,
});

function waitForLibrary(promise, key) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`LIBRARY_LOAD_TIMEOUT:${key}`)), LIBRARY_TIMEOUT_MS);
    }),
  ]).finally(() => clearTimeout(timer));
}

function emitOcrHeartbeat(stage, label, detail = {}) {
  globalThis.dispatchEvent?.(new CustomEvent('ripscan:ocr-heartbeat', {
    detail: { timestamp: globalThis.performance?.now?.() ?? Date.now(), stage, label, ...detail },
  }));
}

function runtimeError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function abortError() {
  const error = new DOMException('OCR_CANCELLED', 'AbortError');
  error.code = 'OCR_CANCELLED';
  return error;
}

function withAbortSignal(factory, signal) {
  if (!signal) return factory();
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      callback(value);
    };
    const onAbort = () => finish(reject, abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve().then(factory).then(
      worker => {
        if (settled) {
          Promise.resolve(worker?.terminate?.()).catch(() => undefined);
          return;
        }
        finish(resolve, worker);
      },
      error => finish(reject, error),
    );
  });
}

function withRuntimeDeadline(factory, { timeoutMs, code, stage, label, onTimeout } = {}) {
  let timeout = null;
  let heartbeat = null;
  let timedOut = false;
  const operation = Promise.resolve().then(factory);
  const deadline = new Promise((_, reject) => {
    heartbeat = setInterval(() => emitOcrHeartbeat(stage, label, { issueType: code }), OCR_RUNTIME.heartbeatMs);
    emitOcrHeartbeat(stage, label, { issueType: code });
    timeout = setTimeout(() => {
      timedOut = true;
      onTimeout?.();
      reject(runtimeError(code, code === 'OCR_WORKER_START_TIMEOUT'
        ? 'เริ่ม OCR Worker ไม่สำเร็จภายใน 90 วินาที ระบบกำลังลองเริ่มใหม่ด้วย Cache ชุดใหม่'
        : 'OCR Worker อ่านข้อความนานเกิน 90 วินาที ระบบหยุด Worker ที่ค้างแล้ว'));
    }, Math.max(1, Number(timeoutMs || 1)));
  });
  operation.then(value => {
    if (timedOut) Promise.resolve(value?.terminate?.()).catch(() => undefined);
  }, () => undefined);
  return Promise.race([operation, deadline]).finally(() => {
    clearTimeout(timeout);
    clearInterval(heartbeat);
  });
}

function wrapRecognize(worker) {
  if (!worker?.recognize || worker.__ripscanRecognizeRecovery === true) return worker;
  const originalRecognize = worker.recognize.bind(worker);
  worker.recognize = (...arguments_) => withRuntimeDeadline(
    () => originalRecognize(...arguments_),
    {
      timeoutMs: OCR_RUNTIME.recognizeTimeoutMs,
      code: 'OCR_RECOGNIZE_TIMEOUT',
      stage: 'recognize',
      label: 'OCR Worker กำลังอ่านข้อความ',
      onTimeout: () => Promise.resolve(worker.terminate?.()).catch(() => undefined),
    },
  );
  Object.defineProperty(worker, '__ripscanRecognizeRecovery', { value: true });
  return worker;
}

function configureTesseract(tesseract) {
  if (!tesseract?.createWorker || tesseract.createWorker.__ripscanLocalRuntime === true) return tesseract;
  const originalCreateWorker = tesseract.createWorker.bind(tesseract);
  const localCreateWorker = async (...arguments_) => {
    const requestedOptions = { ...(arguments_[2] || {}) };
    const signal = requestedOptions.signal;
    delete requestedOptions.signal;
    const originalLogger = requestedOptions.logger;
    let lastError = null;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const options = {
        ...requestedOptions,
        workerPath: OCR_RUNTIME.workerPath,
        corePath: OCR_RUNTIME.corePath,
        langPath: OCR_RUNTIME.langPath,
        gzip: true,
        workerBlobURL: false,
        cacheMethod: attempt === 0 ? (requestedOptions.cacheMethod || 'write') : 'refresh',
        logger(message) {
          originalLogger?.(message);
          emitOcrHeartbeat('worker', String(message?.status || 'กำลังเริ่ม OCR Worker'), {
            workerStatus: message?.status,
            workerProgress: Number(message?.progress || 0),
            retry: attempt,
          });
        },
      };
      const workerArguments = [...arguments_];
      workerArguments[2] = options;
      try {
        if (attempt > 0) emitOcrHeartbeat('worker_retry', 'กำลังเริ่ม OCR Worker ใหม่ด้วย Cache ชุดใหม่ 1/1', { retry: 1 });
        const worker = await withRuntimeDeadline(
          () => withAbortSignal(() => originalCreateWorker(...workerArguments), signal),
          {
            timeoutMs: OCR_RUNTIME.workerStartTimeoutMs,
            code: 'OCR_WORKER_START_TIMEOUT',
            stage: 'worker',
            label: attempt === 0 ? 'กำลังโหลด OCR Core และภาษาไทย–อังกฤษ' : 'กำลังเริ่ม OCR Worker ใหม่ด้วย Cache ชุดใหม่',
          },
        );
        return wrapRecognize(worker);
      } catch (error) {
        lastError = error;
        if (attempt >= 1 || error?.name === 'AbortError') throw error;
      }
    }
    throw lastError || runtimeError('OCR_WORKER_START_FAILED', 'ไม่สามารถเริ่ม OCR Worker ได้');
  };
  Object.defineProperty(localCreateWorker, '__ripscanLocalRuntime', { value: true });
  Object.defineProperty(localCreateWorker, '__ripscanStallGuard', { value: true });
  tesseract.createWorker = localCreateWorker;
  return tesseract;
}

function loadScript(key, urls, ready) {
  if (ready()) return Promise.resolve(ready());
  if (pending.has(key)) return pending.get(key);
  let script;
  const promise = waitForLibrary(new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-ripscan-library="${key}"]`);
    script = existing || document.createElement('script');
    const complete = () => ready() ? resolve(ready()) : reject(new Error(`LIBRARY_NOT_READY:${key}`));
    if (!existing) {
      script.src = Array.isArray(urls) ? urls[0] : urls;
      script.async = true;
      script.crossOrigin = 'anonymous';
      script.dataset.ripscanLibrary = key;
      document.head.append(script);
    }
    script.addEventListener('load', complete, { once: true });
    script.addEventListener('error', () => reject(new Error(`LIBRARY_LOAD_FAILED:${key}`)), { once: true });
    if (existing?.dataset.loaded === 'true') complete();
    script.addEventListener('load', () => { script.dataset.loaded = 'true'; }, { once: true });
  }), key).catch(error => {
    script?.remove();
    throw error;
  }).finally(() => pending.delete(key));
  pending.set(key, promise);
  return promise;
}

export function loadTesseract() {
  if (globalThis.Tesseract?.createWorker) return Promise.resolve(configureTesseract(globalThis.Tesseract));
  return loadScript('tesseract', sources.tesseract, () => globalThis.Tesseract).then(configureTesseract);
}

export function loadJsZip() {
  return loadScript('jszip', sources.jszip, () => globalThis.JSZip);
}

export async function loadPdfJs() {
  if (pending.has('pdfjs')) return pending.get('pdfjs');
  const promise = waitForLibrary(import(sources.pdfjs).then(module => {
    module.GlobalWorkerOptions.workerSrc = sources.pdfWorker;
    return module;
  }), 'pdfjs').finally(() => pending.delete('pdfjs'));
  pending.set('pdfjs', promise);
  return promise;
}

export function preloadLibrary(name) {
  if (name === 'tesseract') return loadTesseract();
  if (name === 'pdfjs') return loadPdfJs();
  if (name === 'jszip') return loadJsZip();
  return Promise.reject(new Error(`UNKNOWN_LIBRARY:${name}`));
}

export const RipScanLazyLibraries = Object.freeze({ loadTesseract, loadJsZip, loadPdfJs, preloadLibrary, runtime: OCR_RUNTIME });
