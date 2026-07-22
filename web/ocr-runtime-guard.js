(() => {
  const WORKER_START_TIMEOUT_MS = 45_000;
  const RECOGNIZE_TIMEOUT_MS = 60_000;

  function runtimeError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function withDeadline(promise, timeoutMs, code, message, onTimeout = () => {}) {
    let timer;
    return new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        Promise.resolve(onTimeout()).catch(() => undefined);
        reject(runtimeError(code, message));
      }, timeoutMs);
      Promise.resolve(promise).then(resolve, reject);
    }).finally(() => clearTimeout(timer));
  }

  function terminateLateWorker(workerPromise) {
    return Promise.resolve(workerPromise)
      .then(worker => worker?.terminate?.())
      .catch(() => undefined);
  }

  function guardWorker(worker) {
    if (!worker?.recognize || worker.__ripscanDeadlineGuard) return worker;
    const originalRecognize = worker.recognize.bind(worker);
    worker.recognize = (...args) => {
      const recognition = Promise.resolve().then(() => originalRecognize(...args));
      return withDeadline(
        recognition,
        RECOGNIZE_TIMEOUT_MS,
        'OCR_RECOGNIZE_TIMEOUT',
        'OCR ใช้เวลานานเกิน 60 วินาที ระบบหยุดงานค้างแล้ว กรุณาลองภาพที่เล็กลงหรือสแกนใหม่',
        () => worker.terminate?.(),
      );
    };
    Object.defineProperty(worker, '__ripscanDeadlineGuard', { value: true });
    return worker;
  }

  async function startWorker(originalCreateWorker, args) {
    const workerArgs = [...args];
    workerArgs[2] = {
      ...(workerArgs[2] || {}),
      workerPath: '/vendor/worker.min.js',
      workerBlobURL: false,
      corePath: '/vendor/tesseract-core/tesseract-core-lstm.wasm.js',
      langPath: '/vendor/tessdata',
      cacheMethod: workerArgs[2]?.cacheMethod || 'write',
    };
    const workerPromise = Promise.resolve().then(() => originalCreateWorker(...workerArgs));
    return withDeadline(
      workerPromise,
      WORKER_START_TIMEOUT_MS,
      'OCR_WORKER_START_TIMEOUT',
      'เริ่มระบบ OCR ไม่สำเร็จภายใน 45 วินาที ระบบหยุดงานที่ค้างแล้ว กรุณาลองใหม่',
      () => terminateLateWorker(workerPromise),
    );
  }

  function patchTesseract() {
    const tesseract = globalThis.Tesseract;
    if (!tesseract?.createWorker) return false;
    if (tesseract.createWorker.__ripscanRuntimeGuard) return true;
    const originalCreateWorker = tesseract.createWorker.bind(tesseract);
    const guardedCreateWorker = async (...args) => guardWorker(await startWorker(originalCreateWorker, args));
    Object.defineProperty(guardedCreateWorker, '__ripscanRuntimeGuard', { value: true });
    tesseract.createWorker = guardedCreateWorker;
    return true;
  }

  if (!patchTesseract()) {
    document.querySelector('script[data-ripscan-tesseract]')?.addEventListener('load', patchTesseract, { once: true });
  }

  globalThis.RipScanOcrRuntimeGuard = Object.freeze({
    patchTesseract,
    workerStartTimeoutMs: WORKER_START_TIMEOUT_MS,
    recognizeTimeoutMs: RECOGNIZE_TIMEOUT_MS,
  });
  document.documentElement.dataset.ocrRuntimeGuard = '3.0.2';
})();
