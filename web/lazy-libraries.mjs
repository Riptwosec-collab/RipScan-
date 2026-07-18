const sources = Object.freeze({
  tesseract: ['/vendor/tesseract.min.js', 'https://cdn.jsdelivr.net/npm/tesseract.js@7/dist/tesseract.min.js'],
  pdfjs: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs',
  pdfWorker: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs',
  jszip: ['/vendor/jszip.min.js', 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js'],
});

const OCR_RUNTIME = Object.freeze({
  workerPath: '/vendor/worker.min.js',
  corePath: '/vendor/tesseract-core',
  langPath: '/vendor/tessdata',
  workerStartTimeoutMs: 90_000,
  recognizeTimeoutMs: 90_000,
  heartbeatMs: 4_000,
});

const pending = new Map();

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
          () => originalCreateWorker(...workerArguments),
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
  const candidates = Array.isArray(urls) ? urls : [urls];
  const promise = (async () => {
    let lastError = null;
    for (const url of candidates) {
      try {
        await new Promise((resolve, reject) => {
          const selector = `script[data-ripscan-library="${key}"][data-ripscan-source="${url}"]`;
          const existing = document.querySelector(selector);
          const script = existing || document.createElement('script');
          const complete = () => ready() ? resolve() : reject(new Error(`LIBRARY_NOT_READY:${key}`));
          if (!existing) {
            script.src = url;
            script.async = true;
            script.crossOrigin = 'anonymous';
            script.dataset.ripscanLibrary = key;
            script.dataset.ripscanSource = url;
            document.head.append(script);
          }
          script.addEventListener('load', complete, { once: true });
          script.addEventListener('error', () => reject(new Error(`LIBRARY_LOAD_FAILED:${key}:${url}`)), { once: true });
          if (existing?.dataset.loaded === 'true') complete();
          script.addEventListener('load', () => { script.dataset.loaded = 'true'; }, { once: true });
        });
        if (ready()) return ready();
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error(`LIBRARY_LOAD_FAILED:${key}`);
  })().finally(() => pending.delete(key));
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
  const promise = import(sources.pdfjs).then(module => {
    module.GlobalWorkerOptions.workerSrc = sources.pdfWorker;
    return module;
  }).finally(() => pending.delete('pdfjs'));
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
